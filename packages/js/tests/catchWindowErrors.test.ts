// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';
import { catchWindowErrors } from '../src/browser/catchWindowErrors';
import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'k' });
    (window as any).flare = client;
    catchWindowErrors();
});

test('Flare error capture survives later reassignment of window.onerror', async () => {
    // User-land code reassigns window.onerror after Flare initialised; should not detach Flare.
    window.onerror = null;

    window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom') }));

    await new Promise((r) => setTimeout(r, 50));
    expect(fakeApi.lastReport?.message).toBe('boom');
});

test('reports non-Error promise rejection reasons (string)', async () => {
    const event = new Event('unhandledrejection') as any;
    event.reason = 'something failed';
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));
    expect(fakeApi.lastReport?.message).toBe('something failed');
    expect(fakeApi.lastReport?.exceptionClass).toBe('UnhandledRejection');
    expect(fakeApi.lastReport?.stacktrace).toEqual([]);
});

test('reports non-Error promise rejection reasons (plain object with message)', async () => {
    const event = new Event('unhandledrejection') as any;
    event.reason = { message: 'object reason' };
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));
    expect(fakeApi.lastReport?.message).toBe('object reason');
    expect(fakeApi.lastReport?.exceptionClass).toBe('UnhandledRejection');
    expect(fakeApi.lastReport?.stacktrace).toEqual([]);
});

test('uses original stack trace from non-Error object with .stack property', async () => {
    const originalStack = `Error: cross-realm failure\n    at userFunction (app.js:10:5)\n    at main (app.js:1:1)`;
    const event = new Event('unhandledrejection') as any;
    event.reason = { message: 'cross-realm failure', stack: originalStack };
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('cross-realm failure');
    expect(fakeApi.lastReport?.exceptionClass).toBe('Error');
    expect(fakeApi.lastReport?.stacktrace[0]?.file).toContain('app.js');
});

test('reports Error rejection with original exceptionClass and stack', async () => {
    const event = new Event('unhandledrejection') as any;
    event.reason = new TypeError('null is not an object');
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));
    expect(fakeApi.lastReport?.message).toBe('null is not an object');
    expect(fakeApi.lastReport?.exceptionClass).toBe('TypeError');
    expect(fakeApi.lastReport?.stacktrace.length).toBeGreaterThan(0);
});
