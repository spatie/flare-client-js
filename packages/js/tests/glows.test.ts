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

test('can log a glow', async () => {
    client.glow('glowName');

    expect(client.glows.length).toBe(1);

    expect(client.glows[0].name).toBe('glowName');
    expect(typeof client.glows[0].microtime).toBe('number');
    expect(typeof client.glows[0].time).toBe('number');
});

test('can log a glow with a message level', async () => {
    client.glow('glowName', 'error', undefined);

    expect(client.glows.length).toBe(1);
    expect(client.glows[0].message_level).toBe('error');
});

test('can log a glow with metadata', async () => {
    client.glow('glowName', 'info', { user: 1 });

    expect(client.glows.length).toBe(1);
    expect(client.glows[0].meta_data).toEqual({ user: 1 });
});
