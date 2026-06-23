import { Api } from './api';
import { CLIENT_VERSION, KEY, SOURCEMAP_VERSION } from './env';
import { Logger, NoopFlushScheduler, partitionAttributes, type FlushScheduler } from './logging';
import { GlobalScopeProvider, USER_IDENTITY_KEYS, type ScopeProvider } from './Scope';
import { createStackTrace } from './stacktrace';
import type { FileReader } from './stacktrace/fileReader';
import { NullFileReader } from './stacktrace/NullFileReader';
import {
    AttributeValue,
    Attributes,
    Config,
    EntryPointHandler,
    Framework,
    Glow,
    MessageLevel,
    Report,
    SdkInfo,
    User,
} from './types';
import { DEFAULT_URL_DENYLIST, assert, assertKey, extractCode, glowsToEvents, now, resolveDenylist } from './util';

export type ContextCollector = (config: Readonly<Config>) => Attributes;

const DEFAULT_SDK_NAME = '@flareapp/core';

export class Flare {
    private inflight = new Set<Promise<void>>();

    private _logger!: Logger;

    private _config: Config = {
        key: null,
        version: '',
        sourcemapVersionId: SOURCEMAP_VERSION,
        stage: '',
        maxGlowsPerReport: 30,
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
        reportBrowserExtensionErrors: false,
        debug: false,
        urlDenylist: DEFAULT_URL_DENYLIST,
        replaceDefaultUrlDenylist: false,
        sampleRate: 1,
        beforeEvaluate: (error) => error,
        beforeSubmit: (report) => report,
        enableLogs: false,
        logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
        maxLogBufferSize: 100,
        logFlushIntervalMs: 5000,
        logFlushMaxBytes: 800_000,
        keepaliveMaxBytes: 60_000,
    };

    private sdkInfo: SdkInfo = { name: DEFAULT_SDK_NAME, version: CLIENT_VERSION };
    private framework: Framework | null = null;

    /**
     * @param api              sends the report over HTTP.
     * @param contextCollector returns per-report attributes (browser DOM info, Node
     *                         process info, etc). Default is a no-op.
     * @param fileReader       reads source files for stack-trace snippets. Default
     *                         returns null (no snippets); `@flareapp/js` injects a
     *                         fetch-based reader, `@flareapp/node` injects a disk reader.
     * @param scopeProvider    returns the current `Scope` (per-call mutable state:
     *                         glows, pendingAttributes, entryPoint). Browser uses a
     *                         single global scope; Node uses an AsyncLocalStorage-
     *                         backed provider so each request gets its own.
     */
    constructor(
        public api: Api = new Api(),
        private contextCollector: ContextCollector = () => ({}),
        private fileReader: FileReader = new NullFileReader(),
        private scopeProvider: ScopeProvider = new GlobalScopeProvider(),
        scheduler: FlushScheduler = new NoopFlushScheduler(),
    ) {
        this._logger = new Logger({
            api: this.api,
            getConfig: () => this._config,
            getSdkInfo: () => this.sdkInfo,
            getFramework: () => this.framework,
            buildLogAttributes: (userAttributes) => this.buildLogAttributes(userAttributes),
            track: (p) => this.track(p),
            scheduler,
        });
    }

    /**
     * Register an in-flight report so `flush()` can wait for it. Called by
     * every public report entry point (`report`, `reportSilently`,
     * `reportMessage`, `reportUnhandledRejection`, `test`); each wraps its
     * full async pipeline (beforeEvaluate -> stack trace + source snippets ->
     * beforeSubmit -> `api.report()`) so the entire roundtrip is what's
     * tracked, not just the HTTP send at the end.
     *
     * Two problems this method solves at once.
     *
     * Problem 1: hold a reference to the work without leaking rejections.
     *
     *   `p` is the real report pipeline; it can reject (network failure,
     *   `beforeSubmit` throws, etc). If we stored `p` directly in `inflight`
     *   and no caller attached a `.catch` (the global error listeners use
     *   `reportSilently` which DOES catch, but the path is still subtle), an
     *   eventual rejection would surface as an unhandled-rejection warning
     *   on Node and a console error in the browser. Bad citizen.
     *
     *   So we build a SHADOW promise that mirrors `p`'s timing but cannot
     *   reject:
     *
     *     p.then(
     *         () => undefined,   // on fulfilment, value is undefined
     *         () => undefined,   // on rejection, ALSO resolve with undefined
     *     )
     *
     *   Providing the second argument means we have "handled" any rejection
     *   from `p`. The shadow always resolves with `undefined`, and `p`'s
     *   rejection is consumed at the boundary. From the runtime's point of
     *   view, the shadow is well-behaved.
     *
     * Problem 2: self-cleaning entry.
     *
     *   `tracked.finally(() => this.inflight.delete(tracked))`. `finally`
     *   fires whether the shadow resolves or rejects, but the shadow can no
     *   longer reject (problem 1 normalized it), so this is effectively
     *   "when the underlying report has settled, remove me from the Set."
     *   No GC magic, no external cleanup, no race window.
     *
     *   Note that `.finally` itself returns a new promise that we drop on
     *   the floor. If the cleanup callback ever throws, that would surface
     *   as an unhandled rejection on the dropped promise; `delete` does not
     *   throw so we are safe today, but anything more elaborate added here
     *   should be wrapped in try/catch.
     *
     * The return value is the ORIGINAL `p`. The caller awaits real success
     * or failure; the tracking is completely invisible to them. This is why
     * `await flare.report(err)` inside a fatal handler observes network
     * errors the same as before tracking was added.
     */
    private track<T>(p: Promise<T>): Promise<T> {
        const tracked = p.then(
            () => undefined,
            () => undefined,
        ) as Promise<void>;
        this.inflight.add(tracked);
        tracked.finally(() => this.inflight.delete(tracked));
        return p;
    }

    /**
     * Wait until every in-flight report settles, or until `timeoutMs`
     * elapses, whichever comes first. Always resolves; never rejects.
     *
     * The main consumer is `@flareapp/node`'s fatal handler:
     *
     *     process.on('uncaughtException', async (err) => {
     *         process.exitCode = 1;
     *         try { await flare.report(err); } catch {}
     *         await flare.flush(shutdownTimeoutMs);
     *         process.exit(1);
     *     });
     *
     * The fatal `report` is awaited explicitly; `flush` then drains any
     * OTHER reports that were already in flight (a request handler that
     * fired `flare.report(...)` concurrently with the crash). The timeout
     * caps the wait so a hung HTTP request cannot indefinitely block
     * shutdown.
     *
     * Walking the implementation:
     *
     *   const pending = [...this.inflight];
     *
     *     Spread takes a SNAPSHOT of the Set at this instant. Reports that
     *     start AFTER this line are not included in `pending`, so they are
     *     not awaited by THIS flush call. This is intentional: it bounds
     *     the wait. Without the snapshot, a handler that kept emitting
     *     reports during shutdown could keep flush alive forever and block
     *     the process from exiting.
     *
     *   if (pending.length === 0) return Promise.resolve();
     *
     *     Fast path. No timer scheduled, no promise constructor needed.
     *     Resolves on the microtask queue. Cheap.
     *
     *   return new Promise<void>((resolve) => {
     *       const timer = setTimeout(resolve, timeoutMs);
     *       Promise.allSettled(pending).then(() => {
     *           clearTimeout(timer);
     *           resolve();
     *       });
     *   });
     *
     *     The race between two outcomes, both calling the same `resolve`:
     *
     *     1. `setTimeout(resolve, timeoutMs)` schedules a "give up" call.
     *        After `timeoutMs` it fires, calling `resolve()` from the
     *        timer-queue side. The outer promise resolves immediately,
     *        even if reports are still pending. Those reports are abandoned
     *        (they continue running but the process is about to die).
     *
     *     2. `Promise.allSettled(pending)` returns a promise that resolves
     *        when every promise in `pending` has either fulfilled or
     *        rejected. It NEVER rejects on its own. We use `allSettled`
     *        rather than `Promise.all` because `all` short-circuits on the
     *        first rejection -- we want to wait for everyone regardless of
     *        whether their HTTP calls succeed or fail. (Our shadows cannot
     *        reject anyway because `track` normalized them, but using
     *        `allSettled` documents the intent and survives future changes
     *        to shadow construction.) When it resolves, we call
     *        `clearTimeout(timer)` to cancel the pending timer (so it does
     *        not fire later and call `resolve` a second time -- a no-op,
     *        but wasted work) and then `resolve()` ourselves.
     *
     *   Resolve can only meaningfully fire once. Subsequent calls to the
     *   same `resolve` are silently ignored by the Promise spec, so the
     *   race is safe even if for some reason both branches fired together.
     *
     * Things flush() deliberately does NOT do:
     *
     *   - It does not reject. Even if every report failed, allSettled
     *     resolves. Callers do not need a `.catch`.
     *   - It does not retry. One pipeline attempt per report, then move on.
     *   - It does not stop new reports from starting. The Flare instance
     *     is still usable after flush resolves. flush is "wait for what is
     *     in flight," not "freeze the SDK."
     *   - It does not drain reports started after the snapshot. Call flush
     *     again if you need to wait for those too.
     */
    flush(timeoutMs = 2000): Promise<void> {
        this._logger.flush();
        const pending = [...this.inflight];
        if (pending.length === 0) return Promise.resolve();
        return new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, timeoutMs);
            Promise.allSettled(pending).then(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    }

    get config(): Readonly<Config> {
        return this._config;
    }

    get glows(): readonly Glow[] {
        return this.scopeProvider.active().glows;
    }

    get logger(): Logger {
        return this._logger;
    }

    light(key: string = KEY, debug?: boolean): this {
        this._config.key = key;
        if (debug !== undefined) {
            this._config.debug = debug;
        }
        this._logger.flush();
        return this;
    }

    configure(config: Partial<Config>): this {
        const wasLogsEnabled = this._config.enableLogs;

        this._config = { ...this._config, ...config };

        if (config.sampleRate !== undefined) {
            this._config.sampleRate = Math.max(0, Math.min(1, config.sampleRate));
        }

        this._config.urlDenylist = resolveDenylist(
            config.urlDenylist,
            config.replaceDefaultUrlDenylist ?? this._config.replaceDefaultUrlDenylist,
        );

        // Only clear the buffer/timer on a real enabled->disabled transition.
        if (wasLogsEnabled && this._config.enableLogs === false) {
            this._logger.clear();
        }
        if (config.key !== undefined) {
            this._logger.flush();
        }

        return this;
    }

    test(): Promise<void> {
        return this.track(this.testInternal());
    }

    private async testInternal(): Promise<void> {
        const report = await this.createReportFromError(new Error('The Flare client is set up correctly!'));
        if (!report) return;
        return this.sendReport(report);
    }

    glow(
        name: string,
        level: MessageLevel = 'info',
        data: Record<string, unknown> | Record<string, unknown>[] = [],
    ): this {
        const time = now();
        this.scopeProvider.active().addGlow(
            {
                name,
                messageLevel: level,
                metaData: data,
                time,
                microtime: time,
            },
            this._config.maxGlowsPerReport,
        );
        return this;
    }

    clearGlows(): this {
        this.scopeProvider.active().clearGlows();
        return this;
    }

    addContext(name: string, value: AttributeValue): this {
        const scope = this.scopeProvider.active();
        const existing =
            (scope.pendingAttributes['context.custom'] as Record<string, AttributeValue> | undefined) ?? {};
        scope.setAttribute('context.custom', { ...existing, [name]: value });
        return this;
    }

    addContextGroup(groupName: string, value: Record<string, AttributeValue>): this {
        this.scopeProvider.active().setAttribute(`context.${groupName}`, value);
        return this;
    }

    /**
     * Attach an identified user to the active scope. Fields are projected to the
     * keys the Flare backend reads: `user.id`, `user.email`, `user.full_name`,
     * and `client.address`. Any extra keys are bundled into `user.attributes`.
     * Pass `null` to clear the user. Scope-aware: in Node this targets the
     * per-request scope via the scope provider.
     */
    setUser(user: User | null): this {
        const scope = this.scopeProvider.active();
        for (const key of USER_IDENTITY_KEYS) delete scope.pendingAttributes[key];
        if (!user) return this;

        const { id, email, fullName, ipAddress, ...rest } = user;
        if (id !== undefined && id !== null) scope.setAttribute('user.id', String(id));
        if (email !== undefined) scope.setAttribute('user.email', email);
        if (fullName !== undefined) scope.setAttribute('user.full_name', fullName);
        if (ipAddress !== undefined) scope.setAttribute('client.address', ipAddress);

        const extras = Object.fromEntries(
            Object.entries(rest).filter(([, value]) => value !== undefined),
        ) as Attributes;
        if (Object.keys(extras).length > 0) scope.setAttribute('user.attributes', extras);

        return this;
    }

    setEntryPoint(handler: EntryPointHandler): this {
        this.scopeProvider.active().entryPoint = handler;
        return this;
    }

    setSdkInfo(info: SdkInfo): this {
        this.sdkInfo = info;
        return this;
    }

    setFramework(framework: Framework): this {
        this.framework = framework;
        return this;
    }

    report(error: Error, attributes: Attributes = {}): Promise<void> {
        return this.track(this.reportInternal(error, attributes));
    }

    private async reportInternal(error: Error, attributes: Attributes = {}): Promise<void> {
        if (this._config.sampleRate < 1 && Math.random() >= this._config.sampleRate) return;

        const seenAtUnixNano = Date.now() * 1_000_000;

        // Coerce non-Error values (strings, rejected promises, etc) so we always have a real Error
        // to walk a stack from. Typed as Error for ergonomics, but consumers may pass anything.
        const coerced = error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error));

        const errorToReport = await this._config.beforeEvaluate(coerced);
        if (!errorToReport) return;

        const report = await this.createReportFromError(errorToReport, attributes, seenAtUnixNano);
        if (!report) return;

        return this.sendReport(report);
    }

    reportSilently(error: Error, attributes: Attributes = {}): void {
        void this.track(this.reportInternal(error, attributes).catch(() => {}));
    }

    reportUnhandledRejection(message: string, attributes: Attributes = {}): Promise<void> {
        return this.track(this.reportUnhandledRejectionInternal(message, attributes));
    }

    private async reportUnhandledRejectionInternal(message: string, attributes: Attributes = {}): Promise<void> {
        if (this._config.sampleRate < 1 && Math.random() >= this._config.sampleRate) return;

        const seenAtUnixNano = Date.now() * 1_000_000;

        const report = this.buildReport({
            exceptionClass: 'UnhandledRejection',
            message,
            stacktrace: [],
            isLog: false,
            level: undefined,
            extraAttributes: attributes,
            code: undefined,
            seenAtUnixNano,
        });

        return this.sendReport(report);
    }

    reportMessage(message: string, level?: MessageLevel, attributes: Attributes = {}): Promise<void> {
        return this.track(this.reportMessageInternal(message, level, attributes));
    }

    private async reportMessageInternal(
        message: string,
        level?: MessageLevel,
        attributes: Attributes = {},
    ): Promise<void> {
        if (this._config.sampleRate < 1 && Math.random() >= this._config.sampleRate) return;

        const seenAtUnixNano = Date.now() * 1_000_000;
        const stackTrace = await createStackTrace(new Error(), this._config.debug, this.fileReader);
        // Drop the top frame so reportMessage itself doesn't appear as the call site.
        stackTrace.shift();

        const report = this.buildReport({
            exceptionClass: 'Log',
            message,
            stacktrace: stackTrace,
            isLog: true,
            level,
            extraAttributes: attributes,
            code: undefined,
            seenAtUnixNano,
        });

        return this.sendReport(report);
    }

    async createReportFromError(
        error: Error,
        attributes: Attributes = {},
        seenAtUnixNano: number = Date.now() * 1_000_000,
    ): Promise<Report | false> {
        if (!assert(error, 'No error provided.', this._config.debug)) {
            return false;
        }

        const stacktrace = await createStackTrace(error, this._config.debug, this.fileReader);

        assert(stacktrace.length, "Couldn't generate stacktrace of this error: " + error, this._config.debug);

        const exceptionClass = error.constructor && error.constructor.name ? error.constructor.name : 'undefined';

        return this.buildReport({
            exceptionClass,
            message: error.message,
            stacktrace,
            isLog: false,
            level: undefined,
            extraAttributes: attributes,
            code: extractCode(error),
            seenAtUnixNano,
        });
    }

    private buildBaseAttributes(): Attributes {
        const baseAttributes: Attributes = {
            'telemetry.sdk.language': 'javascript',
            'telemetry.sdk.name': this.sdkInfo.name,
            'telemetry.sdk.version': this.sdkInfo.version,
            'flare.language.name': 'javascript',
        };

        if (this._config.stage) baseAttributes['service.stage'] = this._config.stage;
        if (this._config.version) baseAttributes['service.version'] = this._config.version;
        if (this.framework?.name) baseAttributes['flare.framework.name'] = this.framework.name;
        if (this.framework?.version) baseAttributes['flare.framework.version'] = this.framework.version;

        return baseAttributes;
    }

    private assembleAttributes(
        collectorAttributes: Attributes,
        extraAttributes: Attributes,
        includeBase: boolean,
    ): Attributes {
        const activeScope = this.scopeProvider.active();

        const baseAttributes: Attributes = includeBase ? this.buildBaseAttributes() : {};

        const entryPoint = activeScope.entryPoint;
        const entryPointOverrides: Attributes = {};
        if (entryPoint?.identifier !== undefined)
            entryPointOverrides['flare.entry_point.handler.identifier'] = entryPoint.identifier;
        if (entryPoint?.type !== undefined) entryPointOverrides['flare.entry_point.handler.type'] = entryPoint.type;
        if (entryPoint?.name !== undefined) entryPointOverrides['flare.entry_point.handler.name'] = entryPoint.name;

        // entryPointOverrides come after the collector so explicitly-set entry-point values
        // win over any defaults the collector provided.
        const attributes: Attributes = {
            ...baseAttributes,
            ...collectorAttributes,
            ...entryPointOverrides,
            ...activeScope.pendingAttributes,
            ...extraAttributes,
        };

        // Deep-merge context.custom: combine the scope's pendingAttributes['context.custom']
        // with the user-supplied extra context.custom per-key (user wins) so scope-set context
        // is not clobbered by the spread above.
        const pendingCustom = activeScope.pendingAttributes['context.custom'];
        const extraCustom = extraAttributes['context.custom'];
        if (
            pendingCustom &&
            extraCustom &&
            typeof pendingCustom === 'object' &&
            typeof extraCustom === 'object' &&
            !Array.isArray(pendingCustom) &&
            !Array.isArray(extraCustom)
        ) {
            attributes['context.custom'] = {
                ...(pendingCustom as Record<string, AttributeValue>),
                ...(extraCustom as Record<string, AttributeValue>),
            };
        }

        // Inject the framework name into context.custom so it is emitted even inside a fresh
        // request scope that carries no other custom context.
        if (this.framework?.name) {
            const existing = (attributes['context.custom'] as Record<string, AttributeValue> | undefined) ?? {};
            attributes['context.custom'] = { ...existing, framework: this.framework.name.toLowerCase() };
        }

        return attributes;
    }

    private buildLogAttributes(userAttributes: Attributes): { record: Attributes; resource: Attributes } {
        const { resource, record: collectorRecord } = partitionAttributes(this.contextCollector(this._config));
        return {
            resource,
            record: this.assembleAttributes(collectorRecord, userAttributes, false),
        };
    }

    private buildReport(input: {
        exceptionClass: string;
        message: string;
        stacktrace: Report['stacktrace'];
        isLog: boolean;
        level: MessageLevel | undefined;
        extraAttributes: Attributes;
        code: string | undefined;
        seenAtUnixNano: number;
    }): Report {
        const activeScope = this.scopeProvider.active();
        const attributes = this.assembleAttributes(this.contextCollector(this._config), input.extraAttributes, true);

        // seenAtUnixNano: real nanoseconds. Date.now() * 1_000_000 exceeds Number.MAX_SAFE_INTEGER
        // by ~3 bits (~256 ns of drift), but browser clocks are millisecond-precision so the lost
        // bits are below source resolution. PHP's json_decode reads the resulting 19-digit literal
        // as a 64-bit int (PHP_INT_MAX ~ 9.22e18 vs our value ~ 1.78e18).
        const report: Report = {
            exceptionClass: input.exceptionClass,
            message: input.message,
            seenAtUnixNano: input.seenAtUnixNano,
            stacktrace: input.stacktrace,
            events: glowsToEvents(activeScope.glows),
            attributes,
        };

        if (input.isLog) {
            report.isLog = true;
        }

        if (input.level !== undefined) {
            report.level = input.level;
        }
        if (this._config.sourcemapVersionId) {
            report.sourcemapVersionId = this._config.sourcemapVersionId;
        }
        if (input.code !== undefined) {
            report.code = input.code;
        }

        return report;
    }

    async sendReport(report: Report): Promise<void> {
        if (!assertKey(this._config.key, this._config.debug)) {
            return;
        }

        const reportToSubmit = await this._config.beforeSubmit(report);
        if (!reportToSubmit) return;

        return this.api.report(
            reportToSubmit,
            this._config.ingestUrl,
            this._config.key,
            this._config.reportBrowserExtensionErrors,
            this._config.debug,
        );
    }
}
