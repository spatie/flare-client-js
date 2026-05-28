// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from 'vitest';

import { Flare } from '../src';
import type { Attributes, Config } from '../src/types';
import { FakeApi } from './helpers';

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

function setLocation(url: string) {
    Object.defineProperty(window, 'location', { configurable: true, value: new URL(url) });
}

function browserCollector(_config: Readonly<Config>): Attributes {
    const attrs: Attributes = { 'flare.entry_point.type': 'web' };
    if (typeof window !== 'undefined' && window?.location?.pathname) {
        attrs['flare.entry_point.handler.identifier'] = window.location.pathname;
        attrs['flare.entry_point.handler.type'] = 'browser';
    }
    return attrs;
}

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi, browserCollector).configure({ key: 'key', debug: true });
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

test('setEntryPoint replaces (does not merge) prior call — name survives', async () => {
    client.setEntryPoint({ identifier: '/a', name: 'A', type: 'vue_route' });
    client.setEntryPoint({ name: 'B' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    expect(a['flare.entry_point.handler.name']).toBe('B');
});

test('setEntryPoint with only name falls back to collector defaults for identifier and type', async () => {
    client.setEntryPoint({ identifier: '/a', name: 'A', type: 'vue_route' });
    client.setEntryPoint({ name: 'B' });

    await client.report(new Error('x'));

    const a = fakeApi.lastReport!.attributes;
    // identifier falls back to default pathname from browser collector
    expect(a['flare.entry_point.handler.identifier']).toBe('/users/42');
    // type falls back to default 'browser' from browser collector
    expect(a['flare.entry_point.handler.type']).toBe('browser');
});
