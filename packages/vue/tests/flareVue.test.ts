import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import { flareVue } from '../src/flareVue';
import type { FlareVueContext, FlareVueOptions } from '../src/types';

const mockReport = vi.fn();
const mockReportMessage = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
        reportMessage: (...args: unknown[]) => mockReportMessage(...args),
    },
}));

function createMockRouter(route: Record<string, unknown>) {
    return { currentRoute: { value: route } };
}

function createMockApp(options?: {
    errorHandler?: (...args: unknown[]) => void;
    warnHandler?: (...args: unknown[]) => void;
    router?: ReturnType<typeof createMockRouter>;
}) {
    return {
        config: {
            errorHandler: options?.errorHandler ?? undefined,
            warnHandler: options?.warnHandler ?? undefined,
            globalProperties: {
                $router: options?.router ?? undefined,
            } as Record<string, unknown>,
        },
    };
}

function createMockInstance(
    name: string,
    parent: ComponentPublicInstance | null = null,
    props: Record<string, unknown> = {}
): ComponentPublicInstance {
    return {
        $options: { __name: name },
        $parent: parent,
        $props: props,
    } as unknown as ComponentPublicInstance;
}

function callHandler(
    app: ReturnType<typeof createMockApp>,
    ...args: Parameters<NonNullable<typeof app.config.errorHandler>>
) {
    app.config.errorHandler!(...args);
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    mockReport.mockReset();
    mockReportMessage.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

describe('flareVue', () => {
    test('sets app.config.errorHandler', () => {
        const app = createMockApp();

        (flareVue as Function)(app);

        expect(typeof app.config.errorHandler).toBe('function');
    });

    test('reports an Error to flare', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        const error = new Error('test error');
        const instance = createMockInstance('MyComponent');

        callHandler(app, error, instance, 'setup function');

        expect(mockReport).toHaveBeenCalledOnce();
        expect(mockReport.mock.calls[0][0]).toBe(error);
    });

    test('converts non-Error values to Error before reporting', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, 'string error', null, 'setup function');

        const reportedError = mockReport.mock.calls[0][0];
        expect(reportedError).toBeInstanceOf(Error);
        expect(reportedError.message).toBe('string error');
    });

    test('passes vue context with info, errorOrigin, componentName, componentProps, componentHierarchy, and componentHierarchyFrames', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

        const grandparent = createMockInstance('App');
        const parent = createMockInstance('Layout', grandparent);
        const instance = createMockInstance('Button', parent, { variant: 'primary' });

        callHandler(app, new Error('test'), instance, 'setup function');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.info).toBe('setup function');
        expect(context.vue.errorOrigin).toBe('setup');
        expect(context.vue.componentName).toBe('Button');
        expect(context.vue.componentProps).toEqual({ variant: 'primary' });
        expect(context.vue.componentHierarchy).toEqual(['Button', 'Layout', 'App']);
        expect(context.vue.componentHierarchyFrames).toEqual([
            { component: 'Button', file: null, props: { variant: 'primary' } },
            { component: 'Layout', file: null, props: {} },
            { component: 'App', file: null, props: {} },
        ]);
    });

    test('sets errorOrigin based on the info string', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), createMockInstance('MyComponent'), 'mounted hook');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.info).toBe('mounted hook');
        expect(context.vue.errorOrigin).toBe('lifecycle');
    });

    test('componentProps is a serialized copy of instance props, not the original reference', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

        const originalProps = { userId: 42 };
        const instance = createMockInstance('UserCard', null, originalProps);

        callHandler(app, new Error('test'), instance, 'setup function');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.componentProps).toEqual({ userId: 42 });
        expect(context.vue.componentProps).not.toBe(originalProps);
    });

    test('passes instance and info as extra solution parameters', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        const instance = createMockInstance('MyComponent');

        callHandler(app, new Error('test'), instance, 'render function');

        const extraParams = mockReport.mock.calls[0][2];
        expect(extraParams.vue.instance).toBe(instance);
        expect(extraParams.vue.info).toBe('render function');
    });

    test('calls initial error handler if one exists', () => {
        const initialHandler = vi.fn();
        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        const error = new Error('test');
        const instance = createMockInstance('MyComponent');

        app.config.errorHandler!(error, instance, 'setup function');

        expect(initialHandler).toHaveBeenCalledOnce();
        expect(initialHandler).toHaveBeenCalledWith(error, instance, 'setup function');
    });

    test('passes original error (not converted) to initial handler', () => {
        const initialHandler = vi.fn();
        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        app.config.errorHandler!('string error', null, 'setup function');

        expect(initialHandler.mock.calls[0][0]).toBe('string error');
    });

    test('does not throw when initial error handler exists', () => {
        const initialHandler = vi.fn();
        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        expect(() => {
            app.config.errorHandler!(new Error('test'), null, 'setup function');
        }).not.toThrow();
    });

    test('does not throw when no initial error handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        expect(() => {
            app.config.errorHandler!(new Error('test error'), null, 'setup function');
        }).not.toThrow();
    });

    test('logs the error to console when no initial error handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        const error = new Error('test error');
        app.config.errorHandler!(error, null, 'setup function');

        expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    });

    test('does not log to console when an initial error handler exists', () => {
        const initialHandler = vi.fn();
        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        app.config.errorHandler!(new Error('test'), null, 'setup function');

        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test('reports to flare when no initial handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), null, 'setup function');

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('still reports to flare before calling initial handler', () => {
        const callOrder: string[] = [];
        const initialHandler = vi.fn(() => callOrder.push('initialHandler'));
        mockReport.mockImplementation(() => callOrder.push('report'));

        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        app.config.errorHandler!(new Error('test'), null, 'setup function');

        expect(callOrder).toEqual(['report', 'initialHandler']);
    });

    test('uses AnonymousComponent when instance is null', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), null, 'setup function');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.componentName).toBe('AnonymousComponent');
        expect('componentProps' in context.vue).toBe(false);
        expect(context.vue.componentHierarchy).toEqual([]);
        expect(context.vue.componentHierarchyFrames).toEqual([]);
    });

    test('logs the converted error (not the raw value) when no initial handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        app.config.errorHandler!('raw string', null, 'setup function');

        const logged = consoleErrorSpy.mock.calls[0][0];
        expect(logged).toBeInstanceOf(Error);
        expect((logged as Error).message).toBe('raw string');
    });

    test('reports each error independently when called multiple times', () => {
        const initialHandler = vi.fn();
        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        const error1 = new Error('first');
        const error2 = new Error('second');

        app.config.errorHandler!(error1, null, 'setup function');
        app.config.errorHandler!(error2, null, 'render function');

        expect(mockReport).toHaveBeenCalledTimes(2);
        expect(mockReport.mock.calls[0][0]).toBe(error1);
        expect(mockReport.mock.calls[1][0]).toBe(error2);
        expect(initialHandler).toHaveBeenCalledTimes(2);
    });

    test('does not call initial handler when flare.report() throws', () => {
        const initialHandler = vi.fn();
        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app);

        mockReport.mockImplementation(() => {
            throw new Error('report failed');
        });

        expect(() => {
            app.config.errorHandler!(new Error('test'), null, 'setup function');
        }).toThrow('report failed');

        expect(initialHandler).not.toHaveBeenCalled();
    });

    test('propagates flare.report() error when no initial handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        mockReport.mockImplementation(() => {
            throw new Error('report failed');
        });

        expect(() => {
            app.config.errorHandler!(new Error('original'), null, 'setup function');
        }).toThrow('report failed');
    });

    test('works without options', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), null, 'setup function');

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('calls beforeEvaluate before building context and reporting', () => {
        const callOrder: string[] = [];

        const beforeEvaluate = vi.fn(() => callOrder.push('beforeEvaluate'));
        mockReport.mockImplementation(() => callOrder.push('report'));

        const app = createMockApp();
        (flareVue as Function)(app, { beforeEvaluate } satisfies FlareVueOptions);

        callHandler(app, new Error('test'), null, 'setup function');

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(callOrder).toEqual(['beforeEvaluate', 'report']);
    });

    test('calls beforeEvaluate with error, instance, and info', () => {
        const beforeEvaluate = vi.fn();

        const app = createMockApp();
        (flareVue as Function)(app, { beforeEvaluate } satisfies FlareVueOptions);

        const error = new Error('test');
        const instance = createMockInstance('MyComponent');

        callHandler(app, error, instance, 'setup function');

        expect(beforeEvaluate.mock.calls[0][0].error).toBe(error);
        expect(beforeEvaluate.mock.calls[0][0].instance).toBe(instance);
        expect(beforeEvaluate.mock.calls[0][0].info).toBe('setup function');
    });

    test('passes the converted error (not raw value) to beforeEvaluate', () => {
        const beforeEvaluate = vi.fn();

        const app = createMockApp();
        (flareVue as Function)(app, { beforeEvaluate } satisfies FlareVueOptions);

        callHandler(app, 'string error', null, 'setup function');

        expect(beforeEvaluate.mock.calls[0][0].error).toBeInstanceOf(Error);
        expect(beforeEvaluate.mock.calls[0][0].error.message).toBe('string error');
    });

    test('calls beforeSubmit after beforeEvaluate and before reporting', () => {
        const callOrder: string[] = [];

        const beforeEvaluate = vi.fn(() => callOrder.push('beforeEvaluate'));
        const beforeSubmit = vi.fn((params: { context: FlareVueContext }) => {
            callOrder.push('beforeSubmit');
            return params.context;
        });
        mockReport.mockImplementation(() => callOrder.push('report'));

        const app = createMockApp();
        (flareVue as Function)(app, { beforeEvaluate, beforeSubmit } satisfies FlareVueOptions);

        callHandler(app, new Error('test'), null, 'setup function');

        expect(beforeSubmit).toHaveBeenCalledOnce();
        expect(callOrder).toEqual(['beforeEvaluate', 'beforeSubmit', 'report']);
    });

    test('calls beforeSubmit with error, instance, info, and context', () => {
        const beforeSubmit = vi.fn(
            (params: { error: Error; instance: unknown; info: string; context: FlareVueContext }) => params.context
        );

        const app = createMockApp();
        (flareVue as Function)(app, { beforeSubmit } satisfies FlareVueOptions);

        const error = new Error('test');
        const instance = createMockInstance('MyComponent');

        callHandler(app, error, instance, 'render function');

        expect(beforeSubmit.mock.calls[0][0].error).toBe(error);
        expect(beforeSubmit.mock.calls[0][0].instance).toBe(instance);
        expect(beforeSubmit.mock.calls[0][0].info).toBe('render function');
        expect(beforeSubmit.mock.calls[0][0].context.vue.componentName).toBe('MyComponent');
        expect(beforeSubmit.mock.calls[0][0].context.vue.componentHierarchy).toEqual(['MyComponent']);
    });

    test('beforeSubmit can modify the context before reporting', () => {
        const customHierarchy = ['Custom', 'Modified'];
        const beforeSubmit = vi.fn(({ context }: { context: FlareVueContext }) => ({
            ...context,
            vue: {
                ...context.vue,
                componentHierarchy: customHierarchy,
            },
        }));

        const app = createMockApp();
        (flareVue as Function)(app, { beforeSubmit } satisfies FlareVueOptions);

        callHandler(app, new Error('test'), createMockInstance('MyComponent'), 'setup function');

        const reportedContext = mockReport.mock.calls[0][1];
        expect(reportedContext.vue.componentHierarchy).toBe(customHierarchy);
    });

    test('uses original context when beforeSubmit does not return', () => {
        const beforeSubmit = vi.fn(() => {
            // user forgot to return context
        });

        const app = createMockApp();
        // @ts-expect-error - intentionally testing a user mistake where beforeSubmit does not return
        (flareVue as Function)(app, { beforeSubmit });

        callHandler(app, new Error('test'), createMockInstance('MyComponent'), 'setup function');

        expect(beforeSubmit).toHaveBeenCalledOnce();
        const reportedContext = mockReport.mock.calls[0][1];
        expect(reportedContext.vue.componentName).toBe('MyComponent');
    });

    test('calls afterSubmit after reporting', () => {
        const callOrder: string[] = [];

        mockReport.mockImplementation(() => callOrder.push('report'));
        const afterSubmit = vi.fn(() => {
            callOrder.push('afterSubmit');
        });

        const app = createMockApp();
        (flareVue as Function)(app, { afterSubmit } satisfies FlareVueOptions);

        const error = new Error('test');
        const instance = createMockInstance('MyComponent');

        callHandler(app, error, instance, 'render function');

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(afterSubmit.mock.calls[0][0].error).toBe(error);
        expect(afterSubmit.mock.calls[0][0].instance).toBe(instance);
        expect(afterSubmit.mock.calls[0][0].info).toBe('render function');
        expect(afterSubmit.mock.calls[0][0].context.vue.componentHierarchy).toBeInstanceOf(Array);
        expect(callOrder).toEqual(['report', 'afterSubmit']);
    });

    test('beforeSubmit modified context is passed to afterSubmit', () => {
        const customHierarchy = ['Custom', 'Modified'];
        const beforeSubmit = vi.fn(({ context }: { context: FlareVueContext }) => ({
            ...context,
            vue: {
                ...context.vue,
                componentHierarchy: customHierarchy,
            },
        }));
        const afterSubmit = vi.fn();

        const app = createMockApp();
        (flareVue as Function)(app, { beforeSubmit, afterSubmit } satisfies FlareVueOptions);

        callHandler(app, new Error('test'), createMockInstance('MyComponent'), 'setup function');

        expect(afterSubmit.mock.calls[0][0].context.vue.componentHierarchy).toBe(customHierarchy);
    });

    test('beforeEvaluate throwing prevents reporting and propagates', () => {
        const beforeEvaluate = vi.fn(() => {
            throw new Error('beforeEvaluate error');
        });

        const app = createMockApp();
        (flareVue as Function)(app, { beforeEvaluate } satisfies FlareVueOptions);

        expect(() => {
            app.config.errorHandler!(new Error('test'), null, 'setup function');
        }).toThrow('beforeEvaluate error');

        expect(beforeEvaluate).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('beforeSubmit throwing prevents reporting and propagates', () => {
        const beforeSubmit = vi.fn(() => {
            throw new Error('beforeSubmit error');
        });

        const app = createMockApp();
        (flareVue as Function)(app, { beforeSubmit } satisfies FlareVueOptions);

        expect(() => {
            app.config.errorHandler!(new Error('test'), null, 'setup function');
        }).toThrow('beforeSubmit error');

        expect(beforeSubmit).toHaveBeenCalledOnce();
        expect(mockReport).not.toHaveBeenCalled();
    });

    test('afterSubmit throwing propagates after reporting', () => {
        const afterSubmit = vi.fn(() => {
            throw new Error('afterSubmit error');
        });

        const app = createMockApp();
        (flareVue as Function)(app, { afterSubmit } satisfies FlareVueOptions);

        expect(() => {
            app.config.errorHandler!(new Error('test'), null, 'setup function');
        }).toThrow('afterSubmit error');

        expect(afterSubmit).toHaveBeenCalledOnce();
        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('callbacks fire for each error when called multiple times', () => {
        const initialHandler = vi.fn();
        const beforeEvaluate = vi.fn();
        const beforeSubmit = vi.fn((params: { context: FlareVueContext }) => params.context);
        const afterSubmit = vi.fn();

        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app, { beforeEvaluate, beforeSubmit, afterSubmit } satisfies FlareVueOptions);

        app.config.errorHandler!(new Error('first'), null, 'setup function');
        app.config.errorHandler!(new Error('second'), null, 'render function');

        expect(beforeEvaluate).toHaveBeenCalledTimes(2);
        expect(beforeSubmit).toHaveBeenCalledTimes(2);
        expect(afterSubmit).toHaveBeenCalledTimes(2);
    });

    test('afterSubmit is called before initial error handler', () => {
        const callOrder: string[] = [];

        const initialHandler = vi.fn(() => callOrder.push('initialHandler'));
        mockReport.mockImplementation(() => callOrder.push('report'));
        const afterSubmit = vi.fn(() => callOrder.push('afterSubmit'));

        const app = createMockApp({ errorHandler: initialHandler });
        (flareVue as Function)(app, { afterSubmit } satisfies FlareVueOptions);

        app.config.errorHandler!(new Error('test'), null, 'setup function');

        expect(callOrder).toEqual(['report', 'afterSubmit', 'initialHandler']);
    });

    describe('attachProps', () => {
        test('omits componentProps from payload by default', () => {
            const app = createMockApp();
            (flareVue as Function)(app);

            const instance = createMockInstance('MyComponent', null, { userId: 1 });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect('componentProps' in context.vue).toBe(false);
        });

        test('omits frame.props on every hierarchy frame by default', () => {
            const app = createMockApp();
            (flareVue as Function)(app);

            const parent = createMockInstance('Parent', null, { flag: true });
            const child = createMockInstance('Child', parent, { id: 1 });
            callHandler(app, new Error('x'), child, 'render function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            context.vue.componentHierarchyFrames.forEach((frame) => {
                expect('props' in frame).toBe(false);
            });
        });

        test('includes serialized componentProps when attachProps is true', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

            const instance = createMockInstance('MyComponent', null, { userId: 42, onClick: () => 0 });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentProps).toEqual({ userId: 42, onClick: '[Function]' });
        });

        test('forwards propsMaxDepth to the serializer for componentProps', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true, propsMaxDepth: 1 } satisfies FlareVueOptions);

            const instance = createMockInstance('MyComponent', null, { nested: { a: { b: 1 } } });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentProps).toEqual({ nested: { a: '[Object]' } });
        });

        test('includes serialized props on each hierarchy frame when attachProps is true', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

            const parent = createMockInstance('Parent', null, { flag: true });
            const child = createMockInstance('Child', parent, { id: 1 });
            callHandler(app, new Error('x'), child, 'render function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentHierarchyFrames.map((frame) => frame.props)).toEqual([
                { id: 1 },
                { flag: true },
            ]);
        });

        test('redacts default sensitive keys from componentProps', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

            const instance = createMockInstance('MyComponent', null, { id: 1, password: 'hunter2', token: 'abc' });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentProps).toEqual({ id: 1, password: '[Redacted]', token: '[Redacted]' });
        });

        test('redacts default sensitive keys from hierarchy frame props', () => {
            const app = createMockApp();
            (flareVue as Function)(app, { attachProps: true } satisfies FlareVueOptions);

            const parent = createMockInstance('Parent', null, { apiKey: 'zzz', flag: true });
            const child = createMockInstance('Child', parent, { id: 1 });
            callHandler(app, new Error('x'), child, 'render function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentHierarchyFrames.map((frame) => frame.props)).toEqual([
                { id: 1 },
                { apiKey: '[Redacted]', flag: true },
            ]);
        });

        test('forwards a custom propsDenylist to the serializer', () => {
            const app = createMockApp();
            (flareVue as Function)(app, {
                attachProps: true,
                propsDenylist: /^ssn$/,
            } satisfies FlareVueOptions);

            const instance = createMockInstance('MyComponent', null, { ssn: '123', password: 'kept' });
            callHandler(app, new Error('x'), instance, 'setup function');

            const context = mockReport.mock.calls[0][1] as FlareVueContext;
            expect(context.vue.componentProps).toEqual({ ssn: '[Redacted]', password: 'kept' });
        });
    });
});

describe('flareVue captureWarnings', () => {
    test('does not set warnHandler when captureWarnings is not set', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        expect(app.config.warnHandler).toBeUndefined();
    });

    test('does not set warnHandler when captureWarnings is false', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: false } satisfies FlareVueOptions);

        expect(app.config.warnHandler).toBeUndefined();
    });

    test('sets warnHandler when captureWarnings is true', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        expect(typeof app.config.warnHandler).toBe('function');
    });

    test('reports warning via flare.reportMessage with message, context, and VueWarning exception class', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        const instance = createMockInstance('Counter');
        app.config.warnHandler!('Invalid prop type', instance, 'found in\n---> <Counter>');

        expect(mockReportMessage).toHaveBeenCalledOnce();
        expect(mockReportMessage).toHaveBeenCalledWith(
            'Invalid prop type',
            {
                vue: {
                    type: 'warning',
                    info: 'Invalid prop type',
                    componentName: 'Counter',
                    componentTrace: 'found in\n---> <Counter>',
                },
            },
            'VueWarning'
        );
    });

    test('context includes component name and trace', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        const instance = createMockInstance('UserProfile');
        const trace = 'found in\n---> <UserProfile> at src/UserProfile.vue\n       <App> at src/App.vue';
        app.config.warnHandler!('Missing required prop', instance, trace);

        const context = mockReportMessage.mock.calls[0][1];
        expect(context.vue.type).toBe('warning');
        expect(context.vue.componentName).toBe('UserProfile');
        expect(context.vue.componentTrace).toBe(trace);
        expect(context.vue.info).toBe('Missing required prop');
    });

    test('uses AnonymousComponent when instance is null', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        app.config.warnHandler!('Some warning', null, '');

        const context = mockReportMessage.mock.calls[0][1];
        expect(context.vue.componentName).toBe('AnonymousComponent');
    });

    test('calls initial warn handler after reporting', () => {
        const initialWarnHandler = vi.fn();
        const app = createMockApp({ warnHandler: initialWarnHandler });
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        const instance = createMockInstance('Counter');
        app.config.warnHandler!('Invalid prop', instance, 'trace');

        expect(mockReportMessage).toHaveBeenCalledOnce();
        expect(initialWarnHandler).toHaveBeenCalledOnce();
        expect(initialWarnHandler).toHaveBeenCalledWith('Invalid prop', instance, 'trace');
    });

    test('calls initial warn handler after flare.reportMessage', () => {
        const callOrder: string[] = [];
        const initialWarnHandler = vi.fn(() => callOrder.push('initialWarnHandler'));
        mockReportMessage.mockImplementation(() => callOrder.push('reportMessage'));

        const app = createMockApp({ warnHandler: initialWarnHandler });
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        app.config.warnHandler!('Warning', null, '');

        expect(callOrder).toEqual(['reportMessage', 'initialWarnHandler']);
    });

    test('reports each warning independently', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        app.config.warnHandler!('First warning', null, 'trace1');
        app.config.warnHandler!('Second warning', null, 'trace2');

        expect(mockReportMessage).toHaveBeenCalledTimes(2);
        expect(mockReportMessage.mock.calls[0][0]).toBe('First warning');
        expect(mockReportMessage.mock.calls[1][0]).toBe('Second warning');
    });

    test('deduplicates warnings with the same message and component', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        const instance = createMockInstance('Counter');
        app.config.warnHandler!('Invalid prop', instance, 'trace');
        app.config.warnHandler!('Invalid prop', instance, 'trace');
        app.config.warnHandler!('Invalid prop', instance, 'trace');

        expect(mockReportMessage).toHaveBeenCalledOnce();
    });

    test('treats the same message on different components as distinct warnings', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        app.config.warnHandler!('Invalid prop', createMockInstance('A'), 'trace');
        app.config.warnHandler!('Invalid prop', createMockInstance('B'), 'trace');

        expect(mockReportMessage).toHaveBeenCalledTimes(2);
    });

    test('still calls the initial warn handler on duplicates even if reporting is suppressed', () => {
        const initialWarnHandler = vi.fn();
        const app = createMockApp({ warnHandler: initialWarnHandler });
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        const instance = createMockInstance('Counter');
        app.config.warnHandler!('Invalid prop', instance, 'trace');
        app.config.warnHandler!('Invalid prop', instance, 'trace');

        expect(mockReportMessage).toHaveBeenCalledOnce();
        expect(initialWarnHandler).toHaveBeenCalledTimes(2);
    });

    test('dedup state is per plugin install', () => {
        const appA = createMockApp();
        const appB = createMockApp();
        (flareVue as Function)(appA, { captureWarnings: true } satisfies FlareVueOptions);
        (flareVue as Function)(appB, { captureWarnings: true } satisfies FlareVueOptions);

        const instance = createMockInstance('Counter');

        appA.config.warnHandler!('Invalid prop', instance, 'trace');
        appB.config.warnHandler!('Invalid prop', instance, 'trace');

        expect(mockReportMessage).toHaveBeenCalledTimes(2);
    });
});

describe('flareVue route context', () => {
    const mockRoute = {
        name: 'user-profile',
        path: '/users/42',
        fullPath: '/users/42?tab=settings',
        params: { id: '42' },
        query: { tab: 'settings' },
        hash: '',
        matched: [{ name: 'AppLayout' }, { name: 'UserProfile' }],
    };

    test('includes route context when Vue Router is present', () => {
        const app = createMockApp({ router: createMockRouter(mockRoute) });
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), null, 'setup function');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.route).toEqual({
            name: 'user-profile',
            path: '/users/42',
            fullPath: '/users/42?tab=settings',
            params: { id: '42' },
            query: { tab: 'settings' },
            hash: '',
            matched: ['AppLayout', 'UserProfile'],
        });
    });

    test('does not include route context when Vue Router is not present', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), null, 'setup function');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.route).toBeUndefined();
    });

    test('includes route context in warning reports when Vue Router is present', () => {
        const app = createMockApp({ router: createMockRouter(mockRoute) });
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        app.config.warnHandler!('Invalid prop', null, 'trace');

        const context = mockReportMessage.mock.calls[0][1];
        expect(context.vue.route).toEqual({
            name: 'user-profile',
            path: '/users/42',
            fullPath: '/users/42?tab=settings',
            params: { id: '42' },
            query: { tab: 'settings' },
            hash: '',
            matched: ['AppLayout', 'UserProfile'],
        });
    });

    test('does not include route context in warning reports when Vue Router is not present', () => {
        const app = createMockApp();
        (flareVue as Function)(app, { captureWarnings: true } satisfies FlareVueOptions);

        app.config.warnHandler!('Warning', null, '');

        const context = mockReportMessage.mock.calls[0][1];
        expect(context.vue.route).toBeUndefined();
    });

    test('route context is available to beforeSubmit hook', () => {
        const beforeSubmit = vi.fn(({ context }: { context: FlareVueContext }) => context);
        const app = createMockApp({ router: createMockRouter(mockRoute) });
        (flareVue as Function)(app, { beforeSubmit } satisfies FlareVueOptions);

        callHandler(app, new Error('test'), null, 'setup function');

        expect(beforeSubmit.mock.calls[0][0].context.vue.route?.name).toBe('user-profile');
    });
});
