// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';
import { catchWindowErrors } from '../src/browser/catchWindowErrors';

import { FakeApi } from './helpers';

type Tracked = { type: string; handler: EventListenerOrEventListenerObject };

let fakeApi: FakeApi;
let tracked: Tracked[];
let origAddEventListener: typeof window.addEventListener;

beforeEach(() => {
    fakeApi = new FakeApi();
    const client = new Flare(fakeApi).configure({ key: 'key' });
    // @ts-ignore — install on window for catchWindowErrors to find it
    window.flare = client;

    tracked = [];
    origAddEventListener = window.addEventListener;
    window.addEventListener = function (
        type: string,
        handler: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
    ) {
        tracked.push({ type, handler });
        return origAddEventListener.call(window, type, handler, options);
    } as typeof window.addEventListener;
});

afterEach(() => {
    for (const { type, handler } of tracked) {
        window.removeEventListener(type, handler);
    }
    window.addEventListener = origAddEventListener;
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

test('reports Symbol rejection reason via String fallback', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: Symbol('boom') });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('Symbol(boom)');
});

test('listeners are cleaned up between tests (no leak)', async () => {
    catchWindowErrors();

    const errorEvent = new ErrorEvent('error', { error: new Error('isolated'), message: 'isolated' });
    window.dispatchEvent(errorEvent);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.reports).toHaveLength(1);
});
