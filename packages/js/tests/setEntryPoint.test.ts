// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';

import { FakeApi } from './helpers';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

function setLocation(url: string) {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(url) });
}

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
    setLocation('https://app.test/users/42');
});

afterEach(() => {
    if (originalLocation) {
        Object.defineProperty(window, 'location', originalLocation);
    }
});

test('default entry point handler is pathname + browser', async () => {
    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['flare.entry_point.handler.identifier']).toBe('/users/42');
    expect(a['flare.entry_point.handler.type']).toBe('browser');
    expect(a['flare.entry_point.handler.name']).toBeUndefined();
});

test('setEntryPoint overrides identifier, type, and name', async () => {
    client.setEntryPoint({ identifier: '/users/:id', name: 'UserShow', type: 'vue_route' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['flare.entry_point.handler.identifier']).toBe('/users/:id');
    expect(a['flare.entry_point.handler.type']).toBe('vue_route');
    expect(a['flare.entry_point.handler.name']).toBe('UserShow');
});

test('setEntryPoint replaces (does not merge) prior call', async () => {
    client.setEntryPoint({ identifier: '/a', name: 'A', type: 'vue_route' });
    client.setEntryPoint({ name: 'B' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    // identifier falls back to default pathname
    expect(a['flare.entry_point.handler.identifier']).toBe('/users/42');
    // type falls back to default 'browser'
    expect(a['flare.entry_point.handler.type']).toBe('browser');
    expect(a['flare.entry_point.handler.name']).toBe('B');
});
