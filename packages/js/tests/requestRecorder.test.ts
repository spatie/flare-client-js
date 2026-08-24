// @vitest-environment jsdom
import type { Attributes, Config } from '@flareapp/core';
import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RequestRecorder } from '../src/breadcrumbs/RequestRecorder';
import type { BreadcrumbHost } from '../src/breadcrumbs/types';
import { publishRequestStart, resetRequestBus } from '../src/instrumentation/requestBus';
import { resetRequestPatches } from '../src/instrumentation/requestInstrumentation';

type Recorded = { type: string; attributes: Attributes };

function fakeHost(overrides: Partial<Config> = {}): BreadcrumbHost & { recorded: Recorded[] } {
    const recorded: Recorded[] = [];
    return {
        recorded,
        config: () =>
            ({
                urlDenylist: DEFAULT_URL_DENYLIST,
                ingestUrl: 'https://ingress.flareapp.io/v1/errors',
                logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
                tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
                ...overrides,
            }) as Config,
        record: (type, attributes) => recorded.push({ type, attributes }),
    };
}

let teardown: (() => void) | null = null;

beforeEach(() => {
    resetRequestBus();
    resetRequestPatches();
});
afterEach(() => {
    teardown?.();
    teardown = null;
});

function send(kind: 'fetch' | 'xhr', method: string, url: string, settle: { status?: number; error?: unknown }) {
    publishRequestStart({ kind, method, url, input: url, init: undefined })?.settle(settle);
}

describe('RequestRecorder', () => {
    it('records method, url, host and status when a fetch settles', () => {
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('fetch', 'POST', 'https://app.example/api/checkout', { status: 201 });

        expect(host.recorded).toEqual([
            {
                type: 'browser_fetch',
                attributes: {
                    'http.request.method': 'POST',
                    'url.full': 'https://app.example/api/checkout',
                    'server.address': 'app.example',
                    'http.response.status_code': 201,
                },
            },
        ]);
    });

    it('stamps an XHR with its own type', () => {
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('xhr', 'GET', 'https://app.example/api/cart', { status: 200 });

        expect(host.recorded[0].type).toBe('browser_xhr');
    });

    it('records a failed request with no status', () => {
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('fetch', 'GET', 'https://app.example/api/cart', { error: new Error('network down') });

        expect(host.recorded[0].attributes['http.response.status_code']).toBeUndefined();
        expect(host.recorded[0].attributes['http.request.method']).toBe('GET');
    });

    it('never records our own report, log or trace posts', () => {
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('fetch', 'POST', 'https://ingress.flareapp.io/v1/errors', { status: 201 });
        send('fetch', 'POST', 'https://ingress.flareapp.io/v1/logs', { status: 201 });
        send('fetch', 'POST', 'https://ingress.flareapp.io/v1/traces', { status: 201 });

        expect(host.recorded).toEqual([]);
    });

    it('redacts a denylisted query value', () => {
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('fetch', 'GET', 'https://app.example/api/reset?token=abc123&page=2', { status: 200 });

        expect(host.recorded[0].attributes['url.full']).toBe('https://app.example/api/reset?token=[redacted]&page=2');
    });

    it('truncates a very long url at 256 characters, with no marker', () => {
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('fetch', 'GET', 'https://app.example/api/search?q=' + 'a'.repeat(400), { status: 200 });

        const url = host.recorded[0].attributes['url.full'] as string;
        expect(url).toHaveLength(256);
        expect(url.endsWith('…')).toBe(false);
    });

    it('resolves a relative url against the page', () => {
        window.history.replaceState({}, '', '/checkout');
        const host = fakeHost();
        teardown = new RequestRecorder(host).install();

        send('fetch', 'GET', '/api/cart', { status: 200 });

        expect(host.recorded[0].attributes['url.full']).toContain('/api/cart');
        expect(host.recorded[0].attributes['server.address']).toBe('localhost');
    });

    it('records nothing after teardown', () => {
        const host = fakeHost();
        new RequestRecorder(host).install()();

        send('fetch', 'GET', 'https://app.example/api/cart', { status: 200 });

        expect(host.recorded).toEqual([]);
    });
});
