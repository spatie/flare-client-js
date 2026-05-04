import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
});

test('beforeEvaluate returning null cancels the report', async () => {
    client.configure({ beforeEvaluate: () => null });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('beforeEvaluate returning false cancels the report', async () => {
    client.configure({ beforeEvaluate: () => false });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('async beforeEvaluate returning null cancels the report', async () => {
    client.configure({ beforeEvaluate: async () => null });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('async beforeEvaluate returning false cancels the report', async () => {
    client.configure({ beforeEvaluate: async (): Promise<false> => false });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('beforeEvaluate can mutate the error', async () => {
    client.configure({
        beforeEvaluate: (error) => {
            error.message = 'rewritten';
            return error;
        },
    });
    await client.report(new Error());
    expect(fakeApi.lastReport?.message).toBe('rewritten');
});

test('async beforeEvaluate can mutate the error', async () => {
    client.configure({
        beforeEvaluate: async (error) => {
            error.message = 'rewritten';
            return error;
        },
    });
    await client.report(new Error());
    expect(fakeApi.lastReport?.message).toBe('rewritten');
});

test('beforeSubmit returning null cancels the report', async () => {
    client.configure({ beforeSubmit: () => null });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('beforeSubmit returning false cancels the report', async () => {
    client.configure({ beforeSubmit: () => false });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('async beforeSubmit returning null cancels the report', async () => {
    client.configure({ beforeSubmit: async () => null });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('async beforeSubmit returning false cancels the report', async () => {
    client.configure({ beforeSubmit: async (): Promise<false> => false });
    await client.report(new Error());
    expect(fakeApi.reports).toHaveLength(0);
});

test('beforeSubmit can mutate the report (camelCase fields)', async () => {
    client.configure({
        beforeSubmit: (report) => {
            report.message = 'rewritten';
            return report;
        },
    });
    await client.report(new Error());
    expect(fakeApi.lastReport?.message).toBe('rewritten');
});

test('async beforeSubmit can mutate the report', async () => {
    client.configure({
        beforeSubmit: async (report) => {
            report.message = 'rewritten';
            return report;
        },
    });
    await client.report(new Error());
    expect(fakeApi.lastReport?.message).toBe('rewritten');
});

test('beforeEvaluate can replace the error with a new Error', async () => {
    client.configure({
        beforeEvaluate: () => new Error('replaced'),
    });
    await client.report(new Error('original'));
    expect(fakeApi.lastReport?.message).toBe('replaced');
});

test('beforeSubmit can mutate attributes', async () => {
    client.configure({
        beforeSubmit: (report) => {
            report.attributes['custom.tag'] = 'value';
            return report;
        },
    });
    await client.report(new Error());
    expect(fakeApi.lastReport?.attributes['custom.tag']).toBe('value');
});
