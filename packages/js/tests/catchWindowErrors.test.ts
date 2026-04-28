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
});

test('reports non-Error promise rejection reasons (plain object with message)', async () => {
    const event = new Event('unhandledrejection') as any;
    event.reason = { message: 'object reason' };
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));
    expect(fakeApi.lastReport?.message).toBe('object reason');
});
