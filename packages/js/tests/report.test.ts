import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({
        key: 'key',
        debug: true,
    });
});

test('can send an error report from an error', async () => {
    const error = new Error('Critical malfunction !?!?');

    await client.report(error);

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('Critical malfunction !?!?');
});

test('can send a message', async () => {
    await client.reportMessage('Hello, Flare!');

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('Hello, Flare!');
});

test('report the test message', async () => {
    await client.test();

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('The Flare client is set up correctly!');
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
