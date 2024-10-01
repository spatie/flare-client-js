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

test('can create custom context and context groups', async () => {
    client.addContext('user', 1);
    client.addContextGroup('tenant', { id: 1 });

    await client.report(new Error());

    expect(fakeApi.reports).toHaveLength(1);
    expect(fakeApi.lastReport?.context).toEqual({
        context: {
            user: 1,
        },
        tenant: {
            id: 1,
        },
    });
});
