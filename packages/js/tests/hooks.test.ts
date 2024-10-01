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

test('can stop a report from being submitted by returning null from beforeEvaluate', async () => {
    client.configure({
        beforeEvaluate: () => null,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can stop a report from being submitted by returning false from beforeEvaluate', async () => {
    client.configure({
        beforeEvaluate: () => false,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can stop a report from being submitted by returning null from async beforeEvaluate', async () => {
    client.configure({
        beforeEvaluate: async () => null,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can stop a report from being submitted by returning false from async beforeEvaluate', async () => {
    client.configure({
        beforeEvaluate: async (): Promise<false> => false,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can edit a report using beforeEvaluate', async () => {
    client.configure({
        beforeEvaluate: (error) => {
            error.message = 'All your base are belong to us';
            return error;
        },
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('All your base are belong to us');
});

test('can edit a report using async beforeEvaluate', async () => {
    client.configure({
        beforeEvaluate: async (error) => {
            error.message = 'All your base are belong to us';
            return error;
        },
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('All your base are belong to us');
});

test('can stop a report from being submitted by returning null from beforeSubmit', async () => {
    client.configure({
        beforeSubmit: () => null,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can stop a report from being submitted by returning false from beforeSubmit', async () => {
    client.configure({
        beforeSubmit: () => false,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can stop a report from being submitted by returning null from async beforeSubmit', async () => {
    client.configure({
        beforeSubmit: async () => null,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can stop a report from being submitted by returning false from async beforeSubmit', async () => {
    client.configure({
        beforeSubmit: async (): Promise<false> => false,
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(0);
});

test('can edit a report using beforeSubmit', async () => {
    client.configure({
        beforeSubmit: (report) => {
            report.message = 'All your base are belong to us';
            return report;
        },
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('All your base are belong to us');
});

test('can edit a report using async beforeSubmit', async () => {
    client.configure({
        beforeSubmit: async (report) => {
            report.message = 'All your base are belong to us';
            return report;
        },
    });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.message).toBe('All your base are belong to us');
});
