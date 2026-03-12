import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ComponentPublicInstance } from 'vue';

import { flareVue } from '../src/flareVue';

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

function createMockInstance(name: string, parent: ComponentPublicInstance | null = null): ComponentPublicInstance {
    return {
        $options: { __name: name },
        $parent: parent,
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

    test('passes vue context with info, componentName, and componentHierarchy', () => {
        const app = createMockApp();
        (flareVue as Function)(app);

        const grandparent = createMockInstance('App');
        const parent = createMockInstance('Layout', grandparent);
        const instance = createMockInstance('Button', parent);

        callHandler(app, new Error('test'), instance, 'setup function');

        const context = mockReport.mock.calls[0][1];
        expect(context.vue.info).toBe('setup function');
        expect(context.vue.componentName).toBe('Button');
        expect(context.vue.componentHierarchy).toEqual(['Button', 'Layout', 'App']);
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
        expect(context.vue.componentHierarchy).toEqual([]);
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
});
