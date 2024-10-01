import { Api } from './api';
import { collectContext } from './context';
import { CLIENT_VERSION, KEY, SOURCEMAP_VERSION } from './env';
import { getSolutions } from './solutions';
import { createStackTrace } from './stacktrace';
import {
    Config,
    Context,
    Glow,
    MessageLevel,
    Report,
    SolutionProvider,
    SolutionProviderExtraParameters,
} from './types';
import { assert, assertKey, assertSolutionProvider, now } from './util';

export class Flare {
    config: Config = {
        key: null,
        version: CLIENT_VERSION,
        sourcemapVersion: SOURCEMAP_VERSION,
        stage: '',
        maxGlowsPerReport: 30,
        reportingUrl: 'https://reporting.flareapp.io/api/reports',
        reportBrowserExtensionErrors: false,
        debug: false,
        beforeEvaluate: (error) => error,
        beforeSubmit: (report) => report,
    };

    glows: Glow[] = [];
    context: Context = { context: {} };
    solutionProviders: SolutionProvider[] = [];

    constructor(public http: Api = new Api()) {}

    light(key: string = KEY, debug: boolean = false): Flare {
        this.config.key = key;
        this.config.debug = debug;

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

        if (this.glows.length > this.config.maxGlowsPerReport) {
            this.glows = this.glows.slice(this.glows.length - this.config.maxGlowsPerReport);
        }

        return this;
    }

    clearGlows(): Flare {
        this.glows = [];

        return this;
    }

    addContext(name: string, value: any): Flare {
        this.context.context[name] = value;

        return this;
    }

    addContextGroup(groupName: string, value: object): Flare {
        this.context[groupName] = value;

        return this;
    }

    registerSolutionProvider(solutionProvider: SolutionProvider): Flare {
        if (!assertSolutionProvider(solutionProvider, this.config.debug)) {
            return this;
        }

        this.solutionProviders.push(solutionProvider);

        return this;
    }

    async report(
        error: Error,
        context: Context = {},
        extraSolutionParameters: SolutionProviderExtraParameters = {}
    ): Promise<void> {
        const errorToReport = await this.config.beforeEvaluate(error);

        if (!errorToReport) {
            return;
        }

        const report = await this.createReportFromError(error, context, extraSolutionParameters);

        if (!report) {
            return;
        }

        return this.sendReport(report);
    }

    async reportMessage(message: string, context: Context = {}, exceptionClass: string = 'Log'): Promise<void> {
        const stackTrace = await createStackTrace(Error(), this.config.debug);

        // The first item in the stacktrace is from this file, and irrelevant
        stackTrace.shift();

        this.sendReport({
            notifier: `Flare JavaScript client v${CLIENT_VERSION}`,
            exception_class: exceptionClass,
            seen_at: now(),
            message: message,
            language: 'javascript',
            glows: this.glows,
            context: collectContext({ ...context, ...this.context }),
            stacktrace: stackTrace,
            sourcemap_version_id: this.config.sourcemapVersion,
            solutions: [],
            stage: this.config.stage,
        });
    }

    createReportFromError(
        error: Error,
        context: Context = {},
        extraSolutionParameters: SolutionProviderExtraParameters = {}
    ): Promise<Report | false> {
        if (!assert(error, 'No error provided.', this.config.debug)) {
            return Promise.resolve(false);
        }

        const seenAt = now();

        return Promise.all([
            getSolutions(this.solutionProviders, error, extraSolutionParameters),
            createStackTrace(error, this.config.debug),
        ]).then((result) => {
            const [solutions, stacktrace] = result;

            assert(stacktrace.length, "Couldn't generate stacktrace of this error: " + error, this.config.debug);

            return {
                notifier: `Flare JavaScript client v${CLIENT_VERSION}`,
                exception_class: error.constructor && error.constructor.name ? error.constructor.name : 'undefined',
                seen_at: seenAt,
                message: error.message,
                language: 'javascript',
                glows: this.glows,
                context: collectContext({ ...context, ...this.context }),
                stacktrace,
                sourcemap_version_id: this.config.sourcemapVersion,
                solutions,
                stage: this.config.stage,
            };
        });
    }

    async sendReport(report: Report): Promise<void> {
        if (!assertKey(this.config.key, this.config.debug)) {
            return;
        }

        const reportToSubmit = await this.config.beforeSubmit(report);

        if (!reportToSubmit) {
            return;
        }

        return this.http.report(
            reportToSubmit,
            this.config.reportingUrl,
            this.config.key,
            this.config.reportBrowserExtensionErrors
        );
    }

    // Deprecated, the following methods exist for backwards compatibility.

    set beforeEvaluate(beforeEvaluate: Config['beforeEvaluate']) {
        this.config.beforeEvaluate = beforeEvaluate ?? '';
    }

    set beforeSubmit(beforeSubmit: Config['beforeSubmit']) {
        this.config.beforeSubmit = beforeSubmit ?? '';
    }

    set stage(stage: string | undefined) {
        this.config.stage = stage ?? '';
    }
}
