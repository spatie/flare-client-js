// @vitest-environment jsdom
import { beforeEach, expect, test } from 'vitest';

import { Flare, GlobalScopeProvider, RecorderType } from '../src';
import { FakeApi } from './helpers';

let fakeApi: FakeApi;
let client: Flare;

beforeEach(() => {
    fakeApi = new FakeApi();
    client = new Flare(fakeApi).configure({ key: 'key', debug: true });
});

test('glows are serialized into php_glow span events on report', async () => {
    client.glow('rendering checkout', 'info', { cartId: 7 });

    await client.reportMessage('hello');

    const event = fakeApi.lastReport!.events[0];
    expect(event.type).toBe('php_glow');
    expect(event.endTimeUnixNano).toBeNull();
    expect(typeof event.startTimeUnixNano).toBe('number');
    expect(event.attributes['glow.name']).toBe('rendering checkout');
    expect(event.attributes['glow.level']).toBe('info');
    expect(event.attributes['glow.context']).toEqual({ cartId: 7 });
});

test('maxGlowsPerReport is a floor, not a ceiling: glows beyond it are still sent', async () => {
    client.configure({ maxGlowsPerReport: 2 });
    client.glow('a').glow('b').glow('c');

    await client.reportMessage('hello');

    expect(client.glows.map((g) => g.name)).toEqual(['a', 'b', 'c']);
    expect(fakeApi.lastReport!.events.map((e) => e.attributes['glow.name'])).toEqual(['a', 'b', 'c']);
});

test('a hard cap still evicts glows once nothing else is left to drop', async () => {
    client.configure({ maxGlowsPerReport: 30, maxBreadcrumbs: 2 });
    client.glow('a').glow('b').glow('c');

    await client.reportMessage('hello');

    expect(fakeApi.lastReport!.events.map((e) => e.attributes['glow.name'])).toEqual(['b', 'c']);
});

test('clearGlows only clears the glow recorder, leaving other entries alone', () => {
    // A plain glow count can't tell clearRecorder(Glow) apart from a full clear(); pin the buffer directly.
    const scopeProvider = new GlobalScopeProvider();
    const scopedClient = new Flare(fakeApi, undefined, undefined, scopeProvider).configure({
        key: 'key',
        debug: true,
    });

    scopedClient.glow('a').glow('b');
    scopeProvider.active().breadcrumbs.add(
        {
            event: { type: 'click', startTimeUnixNano: 1, endTimeUnixNano: null, attributes: {} },
            recorder: RecorderType.Click,
        },
        { maxBreadcrumbs: 100, maxBreadcrumbBytes: 64_000, maxBreadcrumbEntryBytes: 8_000, maxGlowsPerReport: 30 },
    );

    scopedClient.clearGlows();

    expect(scopedClient.glows).toHaveLength(0);
    expect(
        scopeProvider
            .active()
            .breadcrumbs.toEvents()
            .map((e) => e.type),
    ).toEqual(['click']);
});

test('events array is empty when no glows recorded', async () => {
    await client.report(new Error('x'));
    expect(fakeApi.lastReport!.events).toEqual([]);
});
