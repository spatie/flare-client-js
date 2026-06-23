// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';
import type { Attributes, Config } from '../src/types';
import { FakeApi } from './helpers';

function emptyCollector(_config: Readonly<Config>): Attributes {
    return {};
}

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi, emptyCollector).configure({ key: 'key', debug: true });
});

test('setUser writes user.id (stringified), user.email, user.full_name, client.address', async () => {
    client.setUser({ id: 42, email: 'jane@example.com', fullName: 'Jane Doe', ipAddress: '1.2.3.4' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['user.id']).toBe('42');
    expect(a['user.email']).toBe('jane@example.com');
    expect(a['user.full_name']).toBe('Jane Doe');
    expect(a['client.address']).toBe('1.2.3.4');
});

test('setUser bundles extra keys into user.attributes as a nested object that survives to the sent report', async () => {
    client.setUser({ id: 1, email: 'j@x.test', plan: 'pro', teamId: 7 });

    await client.report(new Error('x'));

    expect(fakeApi.lastReport!.attributes['user.attributes']).toEqual({ plan: 'pro', teamId: 7 });
});

test('setUser with no extras does not emit user.attributes', async () => {
    client.setUser({ id: 1 });

    await client.report(new Error('x'));

    expect(fakeApi.lastReport!.attributes['user.attributes']).toBeUndefined();
});

test('setUser(null) clears all identity keys', async () => {
    client.setUser({ id: 1, email: 'j@x.test', fullName: 'J', ipAddress: '9.9.9.9', plan: 'pro' });
    client.setUser(null);

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['user.id']).toBeUndefined();
    expect(a['user.email']).toBeUndefined();
    expect(a['user.full_name']).toBeUndefined();
    expect(a['client.address']).toBeUndefined();
    expect(a['user.attributes']).toBeUndefined();
});

test('setUser overwrites and drops fields omitted on the second call', async () => {
    client.setUser({ id: 1, email: 'first@x.test', plan: 'pro' });
    client.setUser({ id: 2 });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['user.id']).toBe('2');
    expect(a['user.email']).toBeUndefined();
    expect(a['user.attributes']).toBeUndefined();
});
