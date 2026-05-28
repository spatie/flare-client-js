// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Flare } from '../src';
import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
});

afterEach(() => {
    vi.restoreAllMocks();
});

test('sampleRate defaults to 1 (all errors reported)', async () => {
    expect(client.config.sampleRate).toBe(1);

    await client.report(new Error('boom'));
    expect(fakeApi.lastReport).toBeDefined();
});

test('sampleRate 0 drops all errors', async () => {
    client.configure({ sampleRate: 0 });

    for (let i = 0; i < 20; i++) {
        await client.report(new Error(`error-${i}`));
    }

    expect(fakeApi.reports).toHaveLength(0);
});

test('sampleRate 0 drops all messages', async () => {
    client.configure({ sampleRate: 0 });

    for (let i = 0; i < 20; i++) {
        await client.reportMessage(`msg-${i}`);
    }

    expect(fakeApi.reports).toHaveLength(0);
});

test('sampleRate 1 reports all errors', async () => {
    client.configure({ sampleRate: 1 });

    for (let i = 0; i < 10; i++) {
        await client.report(new Error(`error-${i}`));
    }

    expect(fakeApi.reports).toHaveLength(10);
});

test('sampleRate controls proportion of reported errors', async () => {
    client.configure({ sampleRate: 0.5 });

    let callIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
        return callIndex++ % 2 === 0 ? 0.3 : 0.7;
    });

    for (let i = 0; i < 10; i++) {
        await client.report(new Error(`error-${i}`));
    }

    expect(fakeApi.reports).toHaveLength(5);
});

test('test() always sends regardless of sampleRate', async () => {
    client.configure({ sampleRate: 0 });

    await client.test();

    expect(fakeApi.lastReport).toBeDefined();
    expect(fakeApi.lastReport!.message).toBe('The Flare client is set up correctly!');
});

test('sampleRate is clamped to 0 when negative', () => {
    client.configure({ sampleRate: -0.5 });
    expect(client.config.sampleRate).toBe(0);
});

test('sampleRate is clamped to 1 when above 1', () => {
    client.configure({ sampleRate: 2 });
    expect(client.config.sampleRate).toBe(1);
});
