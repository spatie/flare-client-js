import { Flare } from '../src';
import { FakeApi } from './helpers';
import { expect, test, beforeEach } from 'vitest';

let fakeHttp: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeHttp = new FakeApi();
    client = new Flare(fakeHttp).configure({
        key: 'key',
        debug: true,
    });
});

test('can create custom context and context groups', async () => {
    client.addContext('user', 1);
    client.addContextGroup('tenant', { id: 1 });

    await client.report(new Error());

    expect(fakeHttp.reports).toHaveLength(1);
    expect(fakeHttp.lastReport?.context).toEqual({
        context: {
            user: 1,
        },
        tenant: {
            id: 1,
        },
    });
});
