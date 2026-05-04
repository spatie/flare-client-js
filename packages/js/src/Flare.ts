import { Api } from './api';
import { collectAttributes } from './context';
import { CLIENT_VERSION, KEY, SOURCEMAP_VERSION } from './env';
import { createStackTrace } from './stacktrace';
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
} from './types';
import { DEFAULT_URL_DENYLIST, assert, assertKey, extractCode, glowsToEvents, now, redactFullPath } from './util';

const DEFAULT_SDK_NAME = '@flareapp/js';

export class Flare {
    config: Config = {
        key: null,
        version: '',
        sourcemapVersionId: SOURCEMAP_VERSION,
        stage: '',
        maxGlowsPerReport: 30,
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
        reportBrowserExtensionErrors: false,
        debug: false,
        urlDenylist: DEFAULT_URL_DENYLIST,
        beforeEvaluate: (error) => error,
        beforeSubmit: (report) => report,
    };

    glows: Glow[] = [];
    private pendingAttributes: Attributes = {};

    private entryPoint: EntryPointHandler | null = null;
    private sdkInfo: SdkInfo = { name: DEFAULT_SDK_NAME, version: CLIENT_VERSION };
    private framework: Framework | null = null;

    constructor(public api: Api = new Api()) {}

    light(key: string = KEY, debug?: boolean): Flare {
        this.config.key = key;
        if (debug !== undefined) {
            this.config.debug = debug;
        }
        return this;
    }

    configure(config: Partial<Config>): Flare {
        this.config = { ...this.config, ...config };
        return this;
    }

    test(): Promise<void> {
        return this.report(new Error('The Flare client is set up correctly!'));
    }

    glow(name: string, level: MessageLevel = 'info', data: object | object[] = []): Flare {
        const time = now();

        this.glows.push({
            name,
            message_level: level,
            meta_data: data,
            time,
            microtime: time,
        });

        // Cap at maxGlowsPerReport: drop oldest entries so the most recent N remain.
        if (this.glows.length > this.config.maxGlowsPerReport) {
            this.glows = this.glows.slice(this.glows.length - this.config.maxGlowsPerReport);
        }

        return this;
    }

    clearGlows(): Flare {
        this.glows = [];
        return this;
    }

    addContext(name: string, value: unknown): Flare {
        const existing = (this.pendingAttributes['context.custom'] as Record<string, AttributeValue> | undefined) ?? {};
        this.pendingAttributes['context.custom'] = { ...existing, [name]: value as AttributeValue };
        return this;
    }

    addContextGroup(groupName: string, value: object): Flare {
        this.pendingAttributes[`context.${groupName}`] = value as AttributeValue;
        return this;
    }

    setEntryPoint(handler: EntryPointHandler): Flare {
        this.entryPoint = handler;
        return this;
    }

    setSdkInfo(info: SdkInfo): Flare {
        this.sdkInfo = info;
        return this;
    }

    setFramework(framework: Framework): Flare {
        this.framework = framework;
        return this;
    }

    async report(error: Error, attributes: Attributes = {}): Promise<void> {
        const seenAtUnixNano = Date.now() * 1_000_000;

        // Coerce non-Error values (strings, rejected promises, etc) so we always have a real Error
        // to walk a stack from. Typed as Error for ergonomics, but consumers may pass anything.
        const coerced = error instanceof Error ? error : new Error(typeof error === 'string' ? error : String(error));

        const errorToReport = await this.config.beforeEvaluate(coerced);
        if (!errorToReport) return;

        const report = await this.createReportFromError(errorToReport, attributes, seenAtUnixNano);
        if (!report) return;

        return this.sendReport(report);
    }

    async reportMessage(message: string, level?: MessageLevel, attributes: Attributes = {}): Promise<void> {
        const seenAtUnixNano = Date.now() * 1_000_000;
        const stackTrace = await createStackTrace(Error(), this.config.debug);
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
        seenAtUnixNano: number = Date.now() * 1_000_000
    ): Promise<Report | false> {
        if (!assert(error, 'No error provided.', this.config.debug)) {
            return false;
        }

        const stacktrace = await createStackTrace(error, this.config.debug);

        assert(stacktrace.length, "Couldn't generate stacktrace of this error: " + error, this.config.debug);

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
        const baseAttributes: Attributes = {
            'telemetry.sdk.language': 'javascript',
            'telemetry.sdk.name': this.sdkInfo.name,
            'telemetry.sdk.version': this.sdkInfo.version,
            'flare.language.name': 'javascript',
            'flare.entry_point.type': 'web',
        };

        if (typeof window !== 'undefined' && window?.location?.href) {
            baseAttributes['flare.entry_point.value'] = redactFullPath(window.location.href, this.config.urlDenylist);
        }

        const handlerIdentifier =
            this.entryPoint?.identifier ??
            (typeof window !== 'undefined' && window?.location?.pathname ? window.location.pathname : undefined);
        const handlerType = this.entryPoint?.type ?? (typeof window !== 'undefined' && window ? 'browser' : undefined);

        if (handlerIdentifier !== undefined) {
            baseAttributes['flare.entry_point.handler.identifier'] = handlerIdentifier;
        }
        if (handlerType !== undefined) {
            baseAttributes['flare.entry_point.handler.type'] = handlerType;
        }
        if (this.entryPoint?.name !== undefined) {
            baseAttributes['flare.entry_point.handler.name'] = this.entryPoint.name;
        }

        if (this.framework?.name) {
            baseAttributes['flare.framework.name'] = this.framework.name;
        }
        if (this.framework?.version) {
            baseAttributes['flare.framework.version'] = this.framework.version;
        }

        if (this.config.stage) {
            baseAttributes['service.stage'] = this.config.stage;
        }
        if (this.config.version) {
            baseAttributes['service.version'] = this.config.version;
        }

        const attributes: Attributes = {
            ...baseAttributes,
            ...collectAttributes(this.config.urlDenylist),
            ...this.pendingAttributes,
            ...input.extraAttributes,
        };

        // Merge `context.custom` from extraAttributes into pendingAttributes' value
        // instead of overwriting, so framework adapters can attach custom context
        // without clobbering user-set context from addContext().
        const pendingCustom = this.pendingAttributes['context.custom'];
        const extraCustom = input.extraAttributes['context.custom'];
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

        // seenAtUnixNano: real nanoseconds. Date.now() * 1_000_000 exceeds Number.MAX_SAFE_INTEGER
        // by ~3 bits (~256 ns of drift), but browser clocks are millisecond-precision so the lost
        // bits are below source resolution. PHP's json_decode reads the resulting 19-digit literal
        // as a 64-bit int (PHP_INT_MAX ~ 9.22e18 vs our value ~ 1.78e18).
        const report: Report = {
            exceptionClass: input.exceptionClass,
            message: input.message,
            seenAtUnixNano: input.seenAtUnixNano,
            stacktrace: input.stacktrace,
            events: glowsToEvents(this.glows),
            attributes,
        };

        if (input.isLog) {
            report.isLog = true;
        }

        if (input.level !== undefined) {
            report.level = input.level;
        }
        if (this.config.sourcemapVersionId) {
            report.sourcemapVersionId = this.config.sourcemapVersionId;
        }
        if (input.code !== undefined) {
            report.code = input.code;
        }

        return report;
    }

    async sendReport(report: Report): Promise<void> {
        if (!assertKey(this.config.key, this.config.debug)) {
            return;
        }

        const reportToSubmit = await this.config.beforeSubmit(report);
        if (!reportToSubmit) return;

        return this.api.report(
            reportToSubmit,
            this.config.ingestUrl,
            this.config.key,
            this.config.reportBrowserExtensionErrors
        );
    }
}
