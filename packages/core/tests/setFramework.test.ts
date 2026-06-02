import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';
import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
});

test('setFramework emits context.custom.framework in the report', async () => {
    client.setFramework({ name: 'Foo', version: '1.0.0' });
    await client.report(new Error('test'));

    const custom = fakeApi.lastReport!.attributes['context.custom'] as Record<string, unknown>;
    expect(custom.framework).toBe('foo');
});

test('setFramework lowercases the framework name in context.custom.framework', async () => {
    client.setFramework({ name: 'SomeFramework', version: '2.0.0' });
    await client.report(new Error('test'));

    const custom = fakeApi.lastReport!.attributes['context.custom'] as Record<string, unknown>;
    expect(custom.framework).toBe('someframework');
});

test('setFramework does not overwrite user-set context.custom keys', async () => {
    client.setFramework({ name: 'Foo', version: '1.0.0' });
    client.addContext('userId', 42);
    await client.report(new Error('test'));

    const custom = fakeApi.lastReport!.attributes['context.custom'] as Record<string, unknown>;
    expect(custom.framework).toBe('foo');
    expect(custom.userId).toBe(42);
});

test('no context.custom.framework when setFramework was not called', async () => {
    await client.report(new Error('test'));

    const custom = fakeApi.lastReport!.attributes['context.custom'];
    // Either no context.custom at all, or no framework key within it.
    if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
        expect((custom as Record<string, unknown>).framework).toBeUndefined();
    }
});
