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

test('glows are serialized into js_glow span events on report', async () => {
    client.glow('rendering checkout', 'info', { cartId: 7 });

    await client.reportMessage('hello');

    const event = fakeApi.lastReport!.events[0];
    expect(event.type).toBe('js_glow');
    expect(event.endTimeUnixNano).toBeNull();
    expect(typeof event.startTimeUnixNano).toBe('number');
    expect(event.attributes['glow.name']).toBe('rendering checkout');
    expect(event.attributes['glow.level']).toBe('info');
    expect(event.attributes['glow.context']).toEqual({ cartId: 7 });
});

test('glow buffer respects maxGlowsPerReport', () => {
    client.configure({ maxGlowsPerReport: 2 });
    client.glow('a').glow('b').glow('c');

    expect(client.glows).toHaveLength(2);
    expect(client.glows.map((g) => g.name)).toEqual(['b', 'c']);
});

test('clearGlows empties the buffer', () => {
    client.glow('a').glow('b');
    client.clearGlows();

    expect(client.glows).toHaveLength(0);
});

test('events array is empty when no glows recorded', async () => {
    await client.report(new Error('x'));
    expect(fakeApi.lastReport!.events).toEqual([]);
});
