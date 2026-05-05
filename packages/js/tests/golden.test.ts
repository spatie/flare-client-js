// @vitest-environment jsdom
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

const FIXTURE_PATH = resolve(__dirname, 'fixtures/golden-report.json');

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');
const originalReferrer = Object.getOwnPropertyDescriptor(Document.prototype, 'referrer');

function setLocation(url: string) {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(url) });
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-28T12:00:00.000Z'));

    vi.stubGlobal('navigator', { userAgent: 'GoldenAgent/1.0' });
    Object.defineProperty(window.document, 'referrer', {
        configurable: true,
        get: () => 'https://example.com/from',
    });
    Object.defineProperty(window.document, 'readyState', {
        configurable: true,
        get: () => 'complete',
    });
    setLocation('https://app.test/users/42');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalLocation) {
        Object.defineProperty(window, 'location', originalLocation);
    }
    if (originalReferrer) {
        Object.defineProperty(Document.prototype, 'referrer', originalReferrer);
    }
});

test('emits the canonical golden report shape', async () => {
    const fakeApi = new FakeApi();
    const client = new Flare(fakeApi).configure({
        key: 'test-key',
        debug: true,
        version: '1.0.0',
        stage: 'production',
        sourcemapVersionId: 'sourcemap-abc',
    });

    client.setSdkInfo({ name: '@flareapp/js', version: 'golden' });
    client.setEntryPoint({ identifier: '/users/:id', name: 'UserShow', type: 'browser' });
    client.addContext('userId', 7);
    client.addContextGroup('tenant', { id: 9 });
    client.glow('rendering', 'info', { step: 1 });

    const error = Object.assign(new Error('boom'), { code: 'ENOTFOUND' });
    // Pin a deterministic stack so the fixture stays stable across machines.
    error.stack = ['Error: boom', '    at golden (https://app.test/golden.js:10:20)'].join('\n');

    await client.report(error);

    const actual = fakeApi.lastReport!;

    // Stacktrace codeSnippet depends on whether the test environment can
    // fetch the source file -- strip it before snapshotting to keep the
    // fixture machine-independent.
    for (const frame of actual.stacktrace) {
        delete frame.codeSnippet;
    }

    if (process.env.UPDATE_GOLDEN === '1') {
        writeFileSync(FIXTURE_PATH, JSON.stringify(actual, null, 4) + '\n');
    }

    const expected = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

    expect(actual).toEqual(expected);
});
