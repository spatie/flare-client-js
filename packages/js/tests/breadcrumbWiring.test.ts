// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Flare } from '../src/browser';
import { resetNavigation } from '../src/instrumentation/navigation';
import { unpatchFetch } from '../src/instrumentation/requests';
import { resetRequestPatches } from '../src/instrumentation/requests';
import { FakeApi } from './helpers';

async function reportedEvents(flare: Flare, api: FakeApi) {
    api.reports.length = 0;
    await flare.report(new Error('boom'));
    return api.reports[0]?.events ?? [];
}

let flare: Flare;
let api: FakeApi;

beforeEach(() => {
    resetNavigation();
    resetRequestPatches();
    api = new FakeApi();
    flare = new Flare(api);
    flare.configure({ key: 'test-key' });
    document.body.innerHTML = '';
});

afterEach(() => {
    flare.configure({ enableBreadcrumbs: false });
    unpatchFetch();
    resetRequestPatches();
});

describe('breadcrumbs reach the report', () => {
    it('records nothing while the feature is off, which is the default', async () => {
        document.body.innerHTML = '<button id="buy"></button>';

        document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(await reportedEvents(flare, api)).toEqual([]);
    });

    it('puts a click on the report once the feature is on', async () => {
        flare.configure({ enableBreadcrumbs: true });
        document.body.innerHTML = '<button id="buy" class="primary"></button>';

        document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const events = await reportedEvents(flare, api);
        const click = events.find((event) => event.type === 'browser_click');
        expect(click?.attributes['browser.element.selector']).toBe('button#buy.primary');
        expect(click?.endTimeUnixNano).toBeNull();
    });

    it('opens the timeline with the page the person landed on', async () => {
        flare.configure({ enableBreadcrumbs: true });

        const events = await reportedEvents(flare, api);
        expect(events.some((event) => event.type === 'browser_route_change')).toBe(true);
    });

    it('shows glows and breadcrumbs in one list, ordered by time', async () => {
        flare.configure({ enableBreadcrumbs: true });
        document.body.innerHTML = '<button id="buy"></button>';

        flare.glow('before the click');
        document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        const events = await reportedEvents(flare, api);
        const times = events.map((event) => event.startTimeUnixNano);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(events.some((event) => event.type === 'php_glow')).toBe(true);
        expect(events.some((event) => event.type === 'browser_click')).toBe(true);
    });

    it('stops recording and drops what it held when the feature is turned off', async () => {
        flare.configure({ enableBreadcrumbs: true });
        document.body.innerHTML = '<button id="buy"></button>';
        document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        flare.configure({ enableBreadcrumbs: false });
        document.getElementById('buy')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(await reportedEvents(flare, api)).toEqual([]);
    });

    it('keeps only the newest entries once maxBreadcrumbs is reached', async () => {
        flare.configure({ enableBreadcrumbs: true, maxBreadcrumbs: 3 });
        document.body.innerHTML = '<button id="buy"></button>';
        const button = document.getElementById('buy')!;

        for (let i = 0; i < 10; i++) {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }

        expect(await reportedEvents(flare, api)).toHaveLength(3);
    });
});
