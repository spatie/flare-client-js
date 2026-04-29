// @vitest-environment jsdom
import { expect, test } from 'vitest';

import { mapToV2Wire } from '../src/api/mapToV2Wire';
import { Config, Report } from '../src/types';

import golden from './fixtures/golden-v1-to-v2.json';

function baseConfig(overrides: Partial<Config> = {}): Config {
    return {
        key: 'k',
        version: '1.0.0',
        sourcemapVersion: 'sourcemap-abc',
        stage: 'production',
        maxGlowsPerReport: 30,
        reportBrowserExtensionErrors: false,
        reportingUrl: 'https://ingress.flareapp.io/v1/errors',
        debug: false,
        beforeEvaluate: (e) => e,
        beforeSubmit: (r) => r,
        ...overrides,
    };
}

function fullReport(): Report {
    return {
        notifier: 'Flare JavaScript client v?',
        exception_class: 'Error',
        seen_at: 1777377600,
        message: 'boom',
        language: 'javascript',
        glows: [
            {
                time: 1777377600,
                microtime: 1777377600,
                name: 'rendering',
                message_level: 'info',
                meta_data: { step: 1 },
            },
        ],
        context: {
            request: {
                url: 'https://app.test/users/42',
                useragent: 'GoldenAgent/1.0',
                referrer: 'https://example.com/from',
                readyState: 'complete',
            },
            request_data: { queryString: { id: '42' } },
            cookies: { session: 'abc' },
            // addContext('userId', 7) → context.context.userId
            context: { userId: 7 },
            // flare.report(err, {vue: {...}}) → context.vue
            vue: { info: 'render' },
        },
        stacktrace: [
            {
                line_number: 10,
                column_number: 20,
                method: 'golden',
                file: 'https://app.test/golden.js',
                code_snippet: { 10: "throw new Error('boom')" },
                trimmed_column_number: null,
                class: '',
            },
            {
                line_number: 1,
                column_number: 1,
                method: 'external',
                file: 'https://app.test/node_modules/lib/index.js',
                code_snippet: { 1: 'module.exports = ...' },
                trimmed_column_number: null,
                class: '',
            },
        ],
        sourcemap_version_id: 'sourcemap-abc',
        solutions: [
            {
                class: 'X',
                title: 'Y',
                description: 'Z',
                links: {},
            },
        ],
        stage: 'production',
    };
}

test('produces the golden v2 wire payload', () => {
    Object.defineProperty(window, 'location', {
        value: { href: 'https://app.test/users/42' },
        writable: true,
    });

    const wire = mapToV2Wire(fullReport(), baseConfig());

    // CLIENT_VERSION resolves to '?' under vitest (no tsup env injection).
    // Replace before comparing to the fixture.
    expect(wire.attributes['telemetry.sdk.version']).toBeDefined();
    wire.attributes['telemetry.sdk.version'] = '1.2.0';

    expect(wire).toEqual(golden);
});

test('rounds seen_at seconds → seenAtUnixNano (nanoseconds)', () => {
    const r = fullReport();
    r.seen_at = 1.5;

    const wire = mapToV2Wire(r, baseConfig());

    expect(wire.seenAtUnixNano).toBe(1_500_000_000);
});

test('addContext bucket flattens into attributes[context.custom]', () => {
    const r = fullReport();
    r.context = { context: { foo: 1, bar: 'two' } };

    const wire = mapToV2Wire(r, baseConfig());

    expect(wire.attributes['context.custom']).toEqual({ foo: 1, bar: 'two' });
});

test('passed-context keys land in attributes[context.custom]', () => {
    const r = fullReport();
    r.context = { vue: { info: 'render' }, react: { componentStack: ['A', 'B'] } };

    const wire = mapToV2Wire(r, baseConfig());

    expect(wire.attributes['context.custom']).toEqual({
        vue: { info: 'render' },
        react: { componentStack: ['A', 'B'] },
    });
});

test('addContext wins on collision with passed-context key', () => {
    const r = fullReport();
    r.context = {
        context: { vue: { from: 'addContext' } },
        vue: { from: 'passedContext' },
    };

    const wire = mapToV2Wire(r, baseConfig());

    expect((wire.attributes['context.custom'] as any).vue).toEqual({ from: 'addContext' });
});

test('isApplicationFrame heuristic — node_modules → false', () => {
    const r = fullReport();
    r.stacktrace = [
        {
            line_number: 1,
            column_number: 1,
            method: 'm',
            file: 'https://app.test/node_modules/x/y.js',
            code_snippet: {},
            trimmed_column_number: null,
            class: '',
        },
    ];

    const wire = mapToV2Wire(r, baseConfig());

    expect(wire.stacktrace[0].isApplicationFrame).toBe(false);
});

test('isApplicationFrame heuristic — app path → true', () => {
    const r = fullReport();
    r.stacktrace = [
        {
            line_number: 1,
            column_number: 1,
            method: 'm',
            file: 'https://app.test/src/page.js',
            code_snippet: {},
            trimmed_column_number: null,
            class: '',
        },
    ];

    const wire = mapToV2Wire(r, baseConfig());

    expect(wire.stacktrace[0].isApplicationFrame).toBe(true);
});

test('discards solutions — no solutions key, no flare.solutions attribute', () => {
    const wire = mapToV2Wire(fullReport(), baseConfig());

    expect((wire as any).solutions).toBeUndefined();
    expect((wire as any).attributes['flare.solutions']).toBeUndefined();
});

test('omits absent optional fields rather than emitting undefined', () => {
    const r = fullReport();
    delete (r as any).message;
    r.context = {};

    const wire = mapToV2Wire(r, baseConfig({ stage: '' }));

    expect('message' in wire).toBe(false);
    expect('service.stage' in wire.attributes).toBe(false);
});

test('emits class when present, omits when empty', () => {
    const r = fullReport();
    r.stacktrace = [
        {
            line_number: 1,
            column_number: 1,
            method: 'm',
            file: 'https://app.test/x.js',
            code_snippet: {},
            trimmed_column_number: null,
            class: 'MyClass',
        },
        {
            line_number: 2,
            column_number: 2,
            method: 'n',
            file: 'https://app.test/y.js',
            code_snippet: {},
            trimmed_column_number: null,
            class: '',
        },
    ];

    const wire = mapToV2Wire(r, baseConfig());

    expect(wire.stacktrace[0].class).toBe('MyClass');
    expect('class' in wire.stacktrace[1]).toBe(false);
});
