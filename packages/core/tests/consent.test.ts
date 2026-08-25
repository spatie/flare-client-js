// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { Flare } from '../src';
import { FakeApi } from './helpers';

let fakeApi: FakeApi;

beforeEach(() => {
    fakeApi = new FakeApi();
});

afterEach(() => {
    vi.restoreAllMocks();
});

test('hasConsent defaults to true, so setups without a consent tool are unchanged', () => {
    const client = new Flare(fakeApi);
    expect(client.config.hasConsent).toBe(true);
});

test('reports send by default', async () => {
    const client = new Flare(fakeApi).configure({ key: 'key', debug: true });
    await client.report(new Error('boom'));
    expect(fakeApi.reports).toHaveLength(1);
});

test('setConsent(false) blocks error reports', async () => {
    const client = new Flare(fakeApi).configure({ key: 'key', debug: true });
    client.setConsent(false);
    await client.report(new Error('boom'));
    expect(fakeApi.reports).toHaveLength(0);
});

test('setConsent(true) after withdrawal lets the next report through', async () => {
    const client = new Flare(fakeApi).configure({ key: 'key', debug: true });

    client.setConsent(false);
    await client.report(new Error('first'));

    client.setConsent(true);
    await client.report(new Error('second'));

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport!.message).toBe('second');
});

test('a withdrawn report is never assembled, so the context collector never runs (no cookie read)', async () => {
    const collector = vi.fn(() => ({}));
    const client = new Flare(fakeApi, collector).configure({ key: 'key', debug: true });

    client.setConsent(false);
    await client.report(new Error('boom'));
    expect(collector).not.toHaveBeenCalled();

    client.setConsent(true);
    await client.report(new Error('boom'));
    expect(collector).toHaveBeenCalled();
});

test('test() sends nothing while consent is withdrawn', async () => {
    const client = new Flare(fakeApi).configure({ key: 'key', debug: true });
    client.setConsent(false);
    await client.test();
    expect(fakeApi.reports).toHaveLength(0);
});

test('configure({ hasConsent: false }) blocks reports (start-blocked path)', async () => {
    const client = new Flare(fakeApi).configure({ key: 'key', hasConsent: false });
    await client.report(new Error('boom'));
    expect(fakeApi.reports).toHaveLength(0);
});

test('logs are not shipped while consent is withdrawn', async () => {
    const client = new Flare(fakeApi);
    client.light('KEY');
    client.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });
    client.setConsent(false);

    client.logger.info('hello');
    await client.flush();

    expect(fakeApi.logEnvelopes).toHaveLength(0);
});

test('traces are not shipped while consent is withdrawn', async () => {
    const client = new Flare(fakeApi);
    client.light('KEY');
    client.configure({ enableTracing: true });
    client.setConsent(false);

    client.startSpan('op').end();
    await client.flush();

    expect(fakeApi.traceEnvelopes).toHaveLength(0);
});

test('withdrawal drops telemetry captured before it, so a later grant cannot ship it', async () => {
    const client = new Flare(fakeApi);
    client.light('KEY');
    client.configure({ enableLogs: true, logFlushIntervalMs: 999_999 });

    client.logger.info('captured-with-consent'); // buffered, not yet flushed
    client.setConsent(false); // drops the buffer
    client.setConsent(true); // re-grant flushes, but the buffer is empty
    await client.flush();

    expect(fakeApi.logEnvelopes).toHaveLength(0);
});
