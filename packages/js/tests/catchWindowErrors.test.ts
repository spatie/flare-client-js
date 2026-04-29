// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Flare } from '../src';
import { catchWindowErrors } from '../src/browser/catchWindowErrors';

import { FakeApi } from './helpers';

let fakeApi: FakeApi;

beforeEach(() => {
    fakeApi = new FakeApi();
    const client = new Flare(fakeApi).configure({ key: 'key' });
    // @ts-ignore — install on window for catchWindowErrors to find it
    window.flare = client;
});

afterEach(() => {
    // @ts-ignore
    delete window.flare;
});

test('error handler still fires after user reassigns window.onerror', async () => {
    catchWindowErrors();

    // User overrides onerror after Flare has been initialized.
    window.onerror = () => false;

    const errorEvent = new ErrorEvent('error', {
        error: new Error('boom'),
        message: 'boom',
    });
    window.dispatchEvent(errorEvent);

    // flare.report is async; await microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('boom');
});

test('reports non-Error rejection reasons (string)', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: 'plain string reason' });
    window.dispatchEvent(event);

    // flare.report is async; await microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('plain string reason');
});

test('reports non-Error rejection reasons (plain object)', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: { code: 42 } });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toContain('"code":42');
});
