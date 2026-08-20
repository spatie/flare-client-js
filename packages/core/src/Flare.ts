import { Api } from './api';
import { CLIENT_VERSION, KEY, SOURCEMAP_VERSION } from './env';
import { Logger, NoopFlushScheduler, partitionAttributes, type FlushScheduler } from './logging';
import { GlobalScopeProvider, USER_FIELD_KEYS, USER_IDENTITY_KEYS, type ScopeProvider } from './Scope';
import { createStackTrace } from './stacktrace';
import type { FileReader } from './stacktrace/fileReader';
import { NullFileReader } from './stacktrace/NullFileReader';
import { ActiveSpanHolder, InMemoryActiveSpanHolder } from './tracing/context';
import { Tracer } from './tracing/Tracer';
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
    Span,
    SpanOptions,
    User,
} from './types';
import { DEFAULT_URL_DENYLIST, assert, assertKey, extractCode, glowsToEvents, now, resolveDenylist } from './util';

/** Scope attributes a span never inherits. Derived from `USER_IDENTITY_KEYS` so a future user field is
 *  excluded automatically, without anyone needing to remember to list it here. See `getScopeAttributes`. */
const SPAN_SCOPE_EXCLUDED_KEYS: readonly string[] = USER_IDENTITY_KEYS.filter((key) => key !== USER_FIELD_KEYS.id);

export type ContextCollector = (config: Readonly<Config>) => Attributes;

const DEFAULT_SDK_NAME = '@flareapp/core';

export class Flare {
    private inflight = new Set<Promise<void>>();

    private _logger!: Logger;
    private _tracer!: Tracer;

    private _config: Config = {
        key: null,
        version: '',
        sourcemapVersionId: SOURCEMAP_VERSION,
        stage: '',
        maxGlowsPerReport: 30,
        maxBreadcrumbs: 100,
        maxBreadcrumbBytes: 64_000,
        maxBreadcrumbEntryBytes: 8_000,
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
        enableTracing: false,
        tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
        tracesSampleRate: 1,
        maxSpanBufferSize: 100,
        spanFlushIntervalMs: 5000,
        spanFlushMaxBytes: 800_000,
        maxSpansPerTrace: 1024,
        maxAttributesPerSpan: 128,
        maxEventsPerSpan: 128,
        maxAttributesPerSpanEvent: 128,
    };

    private sdkInfo: SdkInfo = { name: DEFAULT_SDK_NAME, version: CLIENT_VERSION };
    private framework: Framework | null = null;

    /**
     * @param api              fetch transport for reports, logs and traces. Stateless: ingest url and
     *                         key are passed per call, so tests swap in a fake.
     * @param contextCollector per-report attributes (browser DOM, Node process). No-op by default.
     * @param fileReader       source files for stack-trace snippets. Defaults to no snippets;
     *                         `@flareapp/js` injects a fetch reader, `@flareapp/node` a disk reader.
     * @param scopeProvider    the current `Scope`. Browser uses one global scope; Node an
     *                         AsyncLocalStorage-backed provider so each request gets its own.
     * @param scheduler        drains the log and span buffers when the host's lifecycle ends (browser
     *                         unload, process exit). No-op by default, leaving only size/timer flushes.
     * @param activeSpanHolder tracks the active span so new spans auto-parent to it. In-memory by
     *                         default; a platform can back it with AsyncLocalStorage instead.
     */
    constructor(
        public api: Api = new Api(),
        private contextCollector: ContextCollector = () => ({}),
        private fileReader: FileReader = new NullFileReader(),
        private scopeProvider: ScopeProvider = new GlobalScopeProvider(),
        scheduler: FlushScheduler = new NoopFlushScheduler(),
        activeSpanHolder: ActiveSpanHolder = new InMemoryActiveSpanHolder(),
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

        this._tracer = new Tracer({
            api: this.api,
            getConfig: () => this._config,
            getSdkInfo: () => this.sdkInfo,
            getFramework: () => this.framework,
            getScopeAttributes: () => this.getScopeAttributes(),
            getResourceAttributes: () => this.spanResourceAttributes(),
            track: (p) => this.track(p),
            scheduler,
            activeSpanHolder,
        });
    }

    /**
     * Register an in-flight report so `flush()` can wait for it. Every entry point wraps its whole async
     * pipeline, from beforeEvaluate through api.report, so flush() waits on all of it.
     *
     * What goes in the Set is a shadow promise that mirrors `p`'s timing but cannot reject, so a failed
     * report never surfaces as an unhandled rejection warning. `p` itself is returned untouched, so the
     * caller still observes real success or failure.
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
     * Wait until every in-flight report settles or `timeoutMs` elapses. Always resolves, never rejects.
     * Written for `@flareapp/node`'s fatal handler, which awaits the fatal report itself then flushes to
     * drain any other concurrent reports before `process.exit`.
     *
     * Snapshotting the Set bounds the wait: reports started after this line are not awaited, so a handler
     * that keeps emitting during shutdown cannot block the process forever. Call flush again for those.
     */
    flush(timeoutMs = 2000): Promise<void> {
        this._logger.flush();
        this._tracer.flush();
        const pending = [...this.inflight];
        if (pending.length === 0) {
            return Promise.resolve();
        }
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

    get tracer(): Tracer {
        return this._tracer;
    }

    /** Starts a span the caller must end. Unlike `withSpan`, it does not become the active span,
     *  so spans started after it do not auto-parent to it. */
    startSpan(name: string, opts?: SpanOptions): Span {
        return this._tracer.startSpan(name, opts);
    }

    /**
     * Runs `fn` with the span active, so spans started inside auto-parent to it, then ends it.
     * Records an error status first if `fn` throws or its returned promise rejects.
     */
    withSpan<T>(name: string, fn: (span: Span) => T, opts?: SpanOptions): T {
        return this._tracer.withSpan(name, fn, opts);
    }

    light(key: string = KEY, debug?: boolean): this {
        this._config.key = key;
        if (debug !== undefined) {
            this._config.debug = debug;
        }
        this._logger.flush();
        this._tracer.flush();
        return this;
    }

    configure(config: Partial<Config>): this {
        const wasLogsEnabled = this._config.enableLogs;
        const wasTracingEnabled = this._config.enableTracing;

        this._config = { ...this._config, ...config };

        if (config.sampleRate !== undefined) {
            this._config.sampleRate = Math.max(0, Math.min(1, config.sampleRate));
        }

        if (config.tracesSampleRate !== undefined) {
            this._config.tracesSampleRate = Math.max(0, Math.min(1, config.tracesSampleRate));
        }

        // Only when this call carries denylist config. Re-resolving with an undefined `custom` would reset a
        // custom denylist to the default, silently re-exposing data the user asked to redact.
        if (config.urlDenylist !== undefined || config.replaceDefaultUrlDenylist !== undefined) {
            this._config.urlDenylist = resolveDenylist(
                config.urlDenylist,
                config.replaceDefaultUrlDenylist ?? this._config.replaceDefaultUrlDenylist,
            );
        }

        // Only clear the buffer/timer on a real enabled->disabled transition.
        if (wasLogsEnabled && this._config.enableLogs === false) {
            this._logger.clear();
        }
        if (config.key !== undefined) {
            this._logger.flush();
        }

        if (wasTracingEnabled && this._config.enableTracing === false) {
            this._tracer.clear();
        }
        if (config.key !== undefined) {
            this._tracer.flush();
        }

        return this;
    }

    test(): Promise<void> {
        return this.track(this.testInternal());
    }

    private async testInternal(): Promise<void> {
        const report = await this.createReportFromError(new Error('The Flare client is set up correctly!'));
        if (!report) {
            return;
        }
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
     * Maps the known fields onto the keys the Flare backend reads (see `USER_FIELD_KEYS`) and bundles
     * anything else into `user.attributes`. Pass `null` to clear. In Node this targets the per-request scope.
     */
    setUser(user: User | null): this {
        const scope = this.scopeProvider.active();
        for (const key of USER_IDENTITY_KEYS) {
            delete scope.pendingAttributes[key];
        }
        if (!user) {
            return this;
        }

        const { id, email, fullName, ipAddress, ...rest } = user;
        if (id !== undefined && id !== null) {
            scope.setAttribute(USER_FIELD_KEYS.id, String(id));
        }
        if (email !== undefined) {
            scope.setAttribute(USER_FIELD_KEYS.email, email);
        }
        if (fullName !== undefined) {
            scope.setAttribute(USER_FIELD_KEYS.fullName, fullName);
        }
        if (ipAddress !== undefined) {
            scope.setAttribute(USER_FIELD_KEYS.ipAddress, ipAddress);
        }

        const extras = Object.fromEntries(
            Object.entries(rest).filter(([, value]) => value !== undefined),
        ) as Attributes;
        if (Object.keys(extras).length > 0) {
            scope.setAttribute('user.attributes', extras);
        }

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
        if (this._config.sampleRate < 1 && Math.random() >= this._config.sampleRate) {
            return;
        }

        const seenAtUnixNano = Date.now() * 1_000_000;

        // Turn a non-Error value into a real Error, so there is always a stack to walk. The parameter is
        // typed as Error to keep the common call easy, but consumers may pass anything.
        const coerced = error instanceof Error ? error : new Error(String(error));

        const errorToReport = await this._config.beforeEvaluate(coerced);
        if (!errorToReport) {
            return;
        }

        const report = await this.createReportFromError(errorToReport, attributes, seenAtUnixNano);
        if (!report) {
            return;
        }

        return this.sendReport(report);
    }

    reportSilently(error: Error, attributes: Attributes = {}): void {
        void this.track(this.reportInternal(error, attributes).catch(() => {}));
    }

    reportUnhandledRejection(message: string, attributes: Attributes = {}): Promise<void> {
        return this.track(this.reportUnhandledRejectionInternal(message, attributes));
    }

    private async reportUnhandledRejectionInternal(message: string, attributes: Attributes = {}): Promise<void> {
        if (this._config.sampleRate < 1 && Math.random() >= this._config.sampleRate) {
            return;
        }

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
        if (this._config.sampleRate < 1 && Math.random() >= this._config.sampleRate) {
            return;
        }

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

        if (this._config.stage) {
            baseAttributes['service.stage'] = this._config.stage;
        }
        if (this._config.version) {
            baseAttributes['service.version'] = this._config.version;
        }
        if (this.framework?.name) {
            baseAttributes['flare.framework.name'] = this.framework.name;
        }
        if (this.framework?.version) {
            baseAttributes['flare.framework.version'] = this.framework.version;
        }

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
        if (entryPoint?.identifier !== undefined) {
            entryPointOverrides['flare.entry_point.handler.identifier'] = entryPoint.identifier;
            // The OTel name for the same value. Set both here so they cannot drift apart.
            entryPointOverrides['http.route'] = entryPoint.identifier;
        }
        if (entryPoint?.type !== undefined) {
            entryPointOverrides['flare.entry_point.handler.type'] = entryPoint.type;
        }
        if (entryPoint?.name !== undefined) {
            entryPointOverrides['flare.entry_point.handler.name'] = entryPoint.name;
        }

        // entryPointOverrides come after the collector so explicit entry-point values win over collector defaults.
        const attributes: Attributes = {
            ...baseAttributes,
            ...collectorAttributes,
            ...entryPointOverrides,
            ...activeScope.pendingAttributes,
            ...extraAttributes,
        };

        // Deep-merge context.custom per-key (user wins) so the spread above does not clobber scope-set context.
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

        // Inject framework name into context.custom so it is emitted even in a fresh request scope with no other custom context.
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

    /**
     * Local roots only, snapshotted by the Tracer at span START so a long-lived root does not drift into
     * the next page's scope. Children get none, and no span ever runs the DOM collector.
     *
     * Everything assembled is inherited except user identity (excluding the opaque `user.id`): a root span
     * goes out for every page view, so email, full name, IP and `user.attributes` would turn normal
     * browsing into PII traffic. The rest — `context.custom`, `addContextGroup` bags — stays in, because
     * the trace viewer renders any span attribute whose key does not start with `flare.`.
     */
    private getScopeAttributes(): Attributes {
        const all = this.assembleAttributes({}, {}, false);
        const scoped: Attributes = { ...all };
        for (const key of SPAN_SCOPE_EXCLUDED_KEYS) {
            delete scoped[key];
        }
        return scoped;
    }

    private spanResourceAttributes(): Attributes {
        // Only the resource partition: record-level context (cookies, url) is heavy and drifts, and this is
        // evaluated once per flush rather than per span.
        return partitionAttributes(this.contextCollector(this._config)).resource;
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

        // seenAtUnixNano overflows MAX_SAFE_INTEGER by ~3 bits (~256ns), which is below the millisecond
        // resolution browser clocks actually have. PHP reads the 19-digit literal as a 64-bit int.
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
        if (!reportToSubmit) {
            return;
        }

        return this.api.report(
            reportToSubmit,
            this._config.ingestUrl,
            this._config.key,
            this._config.reportBrowserExtensionErrors,
            this._config.debug,
        );
    }
}
