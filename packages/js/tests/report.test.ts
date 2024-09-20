import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

let fakeHttp: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeHttp = new FakeApi();
    client = new Flare(fakeHttp).configure({
        key: 'key',
        debug: true,
    });
});

test('can send an error report from an error', async () => {
    const error = new Error('Critical malfunction !?!?');

    await client.report(error);

    expect(fakeHttp.reports).toHaveLength(1);
    expect(fakeHttp.lastReport?.message).toBe('Critical malfunction !?!?');
});

test('can send a message', async () => {
    await client.reportMessage('Hello, Flare!');

    expect(fakeHttp.reports).toHaveLength(1);
    expect(fakeHttp.lastReport?.message).toBe('Hello, Flare!');
});

test('report the test message', async () => {
    await client.test();

    expect(fakeHttp.reports).toHaveLength(1);
    expect(fakeHttp.lastReport?.message).toBe('The Flare client is set up correctly!');
});
