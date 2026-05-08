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
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

test('reports non-Error rejection reasons (plain object)', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: { code: 42 } });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('Unhandled promise rejection: {"code":42}');
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

test('reports Symbol rejection reason via String fallback', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: Symbol('boom') });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('Unhandled promise rejection: Symbol(boom)');
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

test('reports null rejection reason', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: null });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('Unhandled promise rejection (null)');
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

test('reports undefined rejection reason', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: undefined });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('Unhandled promise rejection (undefined)');
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

test('reports empty object rejection reason', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: {} });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('Unhandled promise rejection with non-serializable object');
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

test('extracts message property from error-like object rejection', async () => {
    catchWindowErrors();

    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: { message: 'something went wrong', code: 500 } });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.lastReport?.message).toBe('something went wrong');
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
});

// Regression: v1.2.0 wrapped non-Error rejections in `new Error(message)`, which
// produced exception_class "Error" with message "{}" for empty-object rejections
// and a stack trace pointing at SDK internals instead of user code.
test('empty-object rejection does not produce misleading "Error: {}" report', async () => {
    catchWindowErrors();

    // Simulates: Promise.reject({}) in user code — the exact scenario reported
    const event = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(event, 'reason', { value: {} });
    window.dispatchEvent(event);

    await new Promise((r) => setTimeout(r, 0));

    // Before fix: exception_class was "Error" and message was "{}"
    expect(fakeApi.lastReport?.exception_class).not.toBe('Error');
    expect(fakeApi.lastReport?.message).not.toBe('{}');

    // After fix: clearly labeled as unhandled rejection
    expect(fakeApi.lastReport?.exception_class).toBe('UnhandledPromiseRejection');
    expect(fakeApi.lastReport?.message).toBe('Unhandled promise rejection with non-serializable object');
});

test('listeners are cleaned up between tests (no leak)', async () => {
    catchWindowErrors();

    const errorEvent = new ErrorEvent('error', { error: new Error('isolated'), message: 'isolated' });
    window.dispatchEvent(errorEvent);

    await new Promise((r) => setTimeout(r, 0));

    expect(fakeApi.reports).toHaveLength(1);
});
