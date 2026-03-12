import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import { flareVue } from '../src/flareVue';
import type { FlareVueContext, FlareVueOptions } from '../src/types';

const mockReport = vi.fn();

vi.mock('@flareapp/js', () => ({
    flare: {
        report: (...args: unknown[]) => mockReport(...args),
    },
}));

function createMockApp(initialHandler?: (...args: unknown[]) => void) {
    return {
        config: {
            errorHandler: initialHandler ?? undefined,
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
    try {
        app.config.errorHandler!(...args);
    } catch {
        // Handler re-throws when no initial error handler exists
    }
}

beforeEach(() => {
    mockReport.mockReset();
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
        (flareVue as Function)(app);

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

    test('componentProps is a shallow copy of instance props', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

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
        const app = createMockApp(initialHandler);
        (flareVue as Function)(app);

        const error = new Error('test');
        const instance = createMockInstance('MyComponent');

        app.config.errorHandler!(error, instance, 'setup function');

        expect(initialHandler).toHaveBeenCalledOnce();
        expect(initialHandler).toHaveBeenCalledWith(error, instance, 'setup function');
    });

    test('passes original error (not converted) to initial handler', () => {
        const initialHandler = vi.fn();
        const app = createMockApp(initialHandler);
        (flareVue as Function)(app);

        app.config.errorHandler!('string error', null, 'setup function');

        expect(initialHandler.mock.calls[0][0]).toBe('string error');
    });

    test('does not throw when initial error handler exists', () => {
        const initialHandler = vi.fn();
        const app = createMockApp(initialHandler);
        (flareVue as Function)(app);

        expect(() => {
            app.config.errorHandler!(new Error('test'), null, 'setup function');
        }).not.toThrow();
    });

    test('throws when no initial error handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        expect(() => {
            app.config.errorHandler!(new Error('test error'), null, 'setup function');
        }).toThrow('test error');
    });

    test('reports to flare before throwing when no initial handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        callHandler(app, new Error('test'), null, 'setup function');

        expect(mockReport).toHaveBeenCalledOnce();
    });

    test('still reports to flare before calling initial handler', () => {
        const callOrder: string[] = [];
        const initialHandler = vi.fn(() => callOrder.push('initialHandler'));
        mockReport.mockImplementation(() => callOrder.push('report'));

        const app = createMockApp(initialHandler);
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
        expect(context.vue.componentProps).toBeNull();
        expect(context.vue.componentHierarchy).toEqual([]);
        expect(context.vue.componentHierarchyFrames).toEqual([]);
    });

    test('re-throws the converted error, not the raw value, when no initial handler exists', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        let thrown: unknown;
        try {
            app.config.errorHandler!('raw string', null, 'setup function');
        } catch (e) {
            thrown = e;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe('raw string');
    });

    test('reports each error independently when called multiple times', () => {
        const initialHandler = vi.fn();
        const app = createMockApp(initialHandler);
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
        const app = createMockApp(initialHandler);
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

        const app = createMockApp(initialHandler);
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

        const app = createMockApp(initialHandler);
        (flareVue as Function)(app, { afterSubmit } satisfies FlareVueOptions);

        app.config.errorHandler!(new Error('test'), null, 'setup function');

        expect(callOrder).toEqual(['report', 'afterSubmit', 'initialHandler']);
    });
});
