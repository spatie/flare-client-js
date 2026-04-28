// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
});

test('report() emits new-format payload with required attributes', async () => {
    await client.report(new Error('boom'));

    const r = fakeApi.lastReport!;
    expect(r.message).toBe('boom');
    expect(r.exceptionClass).toBe('Error');
    expect(r.isLog).toBe(false);
    expect(r.attributes['telemetry.sdk.language']).toBe('JavaScript');
    expect(r.attributes['telemetry.sdk.name']).toBe('@flareapp/js');
    expect(r.attributes['flare.language.name']).toBe('JavaScript');
    expect(r.attributes['flare.entry_point.type']).toBe('web');
});

test('report() seenAtUnixNano is roughly current time in nanoseconds', async () => {
    const before = Date.now() * 1_000_000;
    await client.report(new Error('x'));
    const after = Date.now() * 1_000_000;

    const seen = fakeApi.lastReport!.seenAtUnixNano;
    // Allow ~1ms wiggle in either direction.
    expect(seen).toBeGreaterThanOrEqual(before - 1_000_000);
    expect(seen).toBeLessThanOrEqual(after + 1_000_000);
});

test('reportMessage() sets isLog true and exceptionClass=Log', async () => {
    await client.reportMessage('Hello, Flare!');

    expect(fakeApi.lastReport!.isLog).toBe(true);
    expect(fakeApi.lastReport!.exceptionClass).toBe('Log');
    expect(fakeApi.lastReport!.message).toBe('Hello, Flare!');
    expect(fakeApi.lastReport!.level).toBeUndefined();
});

test('reportMessage() with explicit level emits level field', async () => {
    await client.reportMessage('hi', 'warning');

    expect(fakeApi.lastReport!.level).toBe('warning');
});

test('payload contains stacktrace with camelCase frames', async () => {
    await client.report(new Error('x'));

    const frame = fakeApi.lastReport!.stacktrace[0];
    expect(frame).toHaveProperty('lineNumber');
    expect(frame).toHaveProperty('file');
    expect(frame).not.toHaveProperty('line_number');
});

test('does not report browser extension errors by default', async () => {
    await client.test();
    expect(fakeApi.lastReportBrowserExtensionErrors).toBe(false);
});

test('can be configured to report browser extension errors', async () => {
    client.configure({ reportBrowserExtensionErrors: true });
    await client.test();
    expect(fakeApi.lastReportBrowserExtensionErrors).toBe(true);
});

test('auto-populates code from error.code when string', async () => {
    const err = Object.assign(new Error('boom'), { code: 'ENOTFOUND' });
    await client.report(err);

    expect(fakeApi.lastReport!.code).toBe('ENOTFOUND');
});

test('omits code when error.code is missing', async () => {
    await client.report(new Error('boom'));

    expect(fakeApi.lastReport!.code).toBeUndefined();
});

test('addContext writes into attributes["context.custom"]', async () => {
    client.addContext('userId', 7);

    await client.report(new Error('x'));

    expect(fakeApi.lastReport!.attributes['context.custom']).toEqual({ userId: 7 });
});

test('addContextGroup writes into attributes["context.<group>"]', async () => {
    client.addContextGroup('tenant', { id: 9 });

    await client.report(new Error('x'));

    expect(fakeApi.lastReport!.attributes['context.tenant']).toEqual({ id: 9 });
});

test('per-call attributes win over collected attributes', async () => {
    await client.report(new Error('x'), { 'telemetry.sdk.name': 'overridden' });

    expect(fakeApi.lastReport!.attributes['telemetry.sdk.name']).toBe('overridden');
});

test('events is always an array — never undefined', async () => {
    await client.report(new Error('x'));
    expect(Array.isArray(fakeApi.lastReport!.events)).toBe(true);
});
