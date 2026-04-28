// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
});

test('default sdk info is @flareapp/js', async () => {
    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['telemetry.sdk.name']).toBe('@flareapp/js');
    expect(typeof a['telemetry.sdk.version']).toBe('string');
});

test('setSdkInfo overrides name and version (last call wins)', async () => {
    client.setSdkInfo({ name: '@flareapp/react', version: '2.0.0' });
    client.setSdkInfo({ name: '@flareapp/vue', version: '2.0.1' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['telemetry.sdk.name']).toBe('@flareapp/vue');
    expect(a['telemetry.sdk.version']).toBe('2.0.1');
});

test('framework attributes omitted by default', async () => {
    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['flare.framework.name']).toBeUndefined();
    expect(a['flare.framework.version']).toBeUndefined();
});

test('setFramework adds framework attributes', async () => {
    client.setFramework({ name: 'React', version: '19.0.0' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['flare.framework.name']).toBe('React');
    expect(a['flare.framework.version']).toBe('19.0.0');
});

test('setFramework without version omits version attribute', async () => {
    client.setFramework({ name: 'Custom' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['flare.framework.name']).toBe('Custom');
    expect(a['flare.framework.version']).toBeUndefined();
});
