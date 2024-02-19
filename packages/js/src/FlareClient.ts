import { assert, now, flatJsonStringify } from './util';
import { collectContext } from './context';
import { createStackTrace } from './stacktrace';
import build from './build';
import getSolutions from './solutions';
import { Flare } from './types';

export default class FlareClient {
    public version: string = build.clientVersion;

    public config: Flare.Config = {
        key: '',
        reportingUrl: 'https://reporting.flareapp.io/api/reports',
        maxGlowsPerReport: 30,
        maxReportsPerMinute: 500,
    };

    private glows: Array<Flare.Glow> = [];

    private context: Flare.Context = { context: {} };

    public beforeEvaluate: Flare.BeforeEvaluate = (error) => error;

    public beforeSubmit: Flare.BeforeSubmit = (report) => report;

    private reportedErrorsTimestamps: Array<number> = [];

    private solutionProviders: Array<Flare.SolutionProvider> = [];

    private sourcemapVersion: string = build.sourcemapVersion;

    public debug: boolean = false;

    public stage: string | undefined = undefined;

    public light(key: string = build.flareJsKey, debug = false): FlareClient {
        this.debug = debug;

        if (
            !assert(
                key && typeof key === 'string',
                'An empty or incorrect Flare key was passed, errors will not be reported.',
                this.debug,
            ) ||
            !assert(
                Promise,
                'ES6 promises are not supported in this environment, errors will not be reported.',
                this.debug,
            )
        ) {
            return this;
        }

        this.config.key = key;

        return this;
    }

    public glow(
        name: string,
        level: Flare.MessageLevel = 'info',
        metaData: Array<object> = [],
    ): FlareClient {
        const time = now();

        this.glows.push({
            name,
            message_level: level,
            meta_data: metaData,
            time,
            microtime: time,
        });

        if (this.glows.length > this.config.maxGlowsPerReport) {
            this.glows = this.glows.slice(
                this.glows.length - this.config.maxGlowsPerReport,
            );
        }

        return this;
    }

    public addContext(name: string, value: any): FlareClient {
        this.context.context[name] = value;

        return this;
    }

    public addContextGroup(groupName: string, value: object): FlareClient {
        this.context[groupName] = value;

        return this;
    }

    public registerSolutionProvider(
        provider: Flare.SolutionProvider,
    ): FlareClient {
        if (
            !assert(
                'canSolve' in provider,
                'A solution provider without a [canSolve] property was added.',
                this.debug,
            ) ||
            !assert(
                'getSolutions' in provider,
                'A solution provider without a [getSolutions] property was added.',
                this.debug,
            )
        ) {
            return this;
        }

        this.solutionProviders.push(provider);

        return this;
    }

    public reportMessage(
        message: string,
        context: Flare.Context = {},
        exceptionClass: string = 'Log',
    ): void {
        const seenAt = now();

        createStackTrace(Error()).then((stacktrace) => {
            // The first item in the stacktrace is from this file, and irrelevant
            stacktrace.shift();

            const report: Flare.ErrorReport = {
                notifier: `Flare JavaScript client v${build.clientVersion}`,
                exception_class: exceptionClass,
                seen_at: seenAt,
                message: message,
                language: 'javascript',
                glows: this.glows,
                context: collectContext({ ...context, ...this.context }),
                stacktrace,
                sourcemap_version_id: this.sourcemapVersion,
                solutions: [],
                stage: this.stage,
            };

            this.sendReport(report);
        });
    }

    public report(
        error: Error,
        context: Flare.Context = {},
        extraSolutionParameters: Flare.SolutionProviderExtraParameters = {},
    ): void {
        Promise.resolve(this.beforeEvaluate(error)).then(
            (reportReadyForEvaluation) => {
                if (!reportReadyForEvaluation) {
                    return;
                }

                this.createReport(error, context, extraSolutionParameters).then(
                    (report) => (report ? this.sendReport(report) : {}),
                );
            },
        );
    }

    public createReport(
        error: Error,
        context: Flare.Context = {},
        extraSolutionParameters: Flare.SolutionProviderExtraParameters = {},
    ): Promise<Flare.ErrorReport | false> {
        if (!assert(error, 'No error provided.', this.debug)) {
            return Promise.resolve(false);
        }

        const seenAt = now();

        return Promise.all([
            getSolutions(
                this.solutionProviders,
                error,
                extraSolutionParameters,
            ),
            createStackTrace(error),
        ]).then((result) => {
            const [solutions, stacktrace] = result;

            assert(
                stacktrace.length,
                "Couldn't generate stacktrace of this error: " + error,
                this.debug,
            );

            return {
                notifier: `Flare JavaScript client v${build.clientVersion}`,
                exception_class:
                    error.constructor && error.constructor.name
                        ? error.constructor.name
                        : 'undefined',
                seen_at: seenAt,
                message: error.message,
                language: 'javascript',
                glows: this.glows,
                context: collectContext({ ...context, ...this.context }),
                stacktrace,
                sourcemap_version_id: this.sourcemapVersion,
                solutions,
                stage: this.stage,
            };
        });
    }

    private sendReport(report: Flare.ErrorReport): void {
        if (
            !assert(
                this.config.key,
                'The client was not yet initialised with an API key. ' +
                    "Run client.light('<flare-project-key>') when you initialise your app. " +
                    "If you are running in dev mode and didn't run the light command on purpose, you can ignore this error.",
                this.debug,
            )
        ) {
            return;
        }

        if (this.maxReportsPerMinuteReached()) {
            return;
        }

        Promise.resolve(this.beforeSubmit(report)).then(
            (reportReadyForSubmit) => {
                if (!reportReadyForSubmit) {
                    return;
                }

                fetch(this.config.reportingUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'x-api-token': this.config.key,
                    },
                    body: flatJsonStringify({
                        ...reportReadyForSubmit,
                        key: this.config.key,
                    }),
                }).then(
                    (response) => {
                        if (response.status !== 204) {
                            console.error(
                                `Received response with status ${response.status} from Flare`,
                            );
                        }
                    },
                    (error) => console.error(error),
                );

                this.reportedErrorsTimestamps.push(Date.now());
            },
        );
    }

    private maxReportsPerMinuteReached(): boolean {
        if (
            this.reportedErrorsTimestamps.length >=
            this.config.maxReportsPerMinute
        ) {
            const nErrorsBack =
                this.reportedErrorsTimestamps[
                    this.reportedErrorsTimestamps.length -
                        this.config.maxReportsPerMinute
                ];

            if (nErrorsBack > Date.now() - 60 * 1000) {
                return true;
            }
        }

        return false;
    }

    public test(): FlareClient {
        this.report(new Error('The Flare client is set up correctly!'));

        return this;
    }
}
