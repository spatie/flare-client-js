import { describe, expect, it } from 'vitest';

import { breadcrumbUrl, MAX_BREADCRUMB_URL_LENGTH, recordBreadcrumb } from '../src/breadcrumbs/recordBreadcrumb';
import { GlobalScopeProvider, Scope } from '../src/Scope';
import type { Config, Glow, SpanEvent } from '../src/types';
import { DEFAULT_URL_DENYLIST, timelineEvents } from '../src/util';

function config(overrides: Partial<Config> = {}): Config {
    return { enableBreadcrumbs: true, maxBreadcrumbs: 100, ...overrides } as Config;
}

function crumb(type: string, startTimeUnixNano: number): SpanEvent {
    return { type, startTimeUnixNano, endTimeUnixNano: null, attributes: {} };
}

describe('the buffer', () => {
    it('keeps the newest and drops the oldest once it is full', () => {
        const scope = new Scope();

        for (let i = 1; i <= 5; i++) {
            scope.addBreadcrumb(crumb('browser_click', i), 3);
        }

        expect(scope.breadcrumbs.map((b) => b.startTimeUnixNano)).toEqual([3, 4, 5]);
    });

    it('records nothing when the cap is zero', () => {
        const scope = new Scope();

        scope.addBreadcrumb(crumb('browser_click', 1), 0);

        expect(scope.breadcrumbs).toEqual([]);
    });

    it('is emptied by clearBreadcrumbs and leaves glows alone', () => {
        const scope = new Scope();
        scope.addBreadcrumb(crumb('browser_click', 1), 100);
        scope.addGlow({ name: 'g', messageLevel: 'info', metaData: {}, time: 1, microtime: 1 }, 30);

        scope.clearBreadcrumbs();

        expect(scope.breadcrumbs).toEqual([]);
        expect(scope.glows).toHaveLength(1);
    });
});

describe('recordBreadcrumb', () => {
    it('writes onto the active scope', () => {
        const provider = new GlobalScopeProvider();

        recordBreadcrumb(provider, config(), 'browser_click', { 'browser.element.selector': 'button#buy' }, 42);

        expect(provider.active().breadcrumbs).toEqual([
            {
                type: 'browser_click',
                startTimeUnixNano: 42,
                endTimeUnixNano: null,
                attributes: { 'browser.element.selector': 'button#buy' },
            },
        ]);
    });

    it('records nothing while the feature is off', () => {
        const provider = new GlobalScopeProvider();

        recordBreadcrumb(provider, config({ enableBreadcrumbs: false }), 'browser_click', {}, 42);

        expect(provider.active().breadcrumbs).toEqual([]);
    });

    it('honours maxBreadcrumbs from the config', () => {
        const provider = new GlobalScopeProvider();

        for (let i = 1; i <= 4; i++) {
            recordBreadcrumb(provider, config({ maxBreadcrumbs: 2 }), 'browser_click', {}, i);
        }

        expect(provider.active().breadcrumbs.map((b) => b.startTimeUnixNano)).toEqual([3, 4]);
    });
});

describe('breadcrumbUrl', () => {
    it('leaves a short url alone', () => {
        expect(breadcrumbUrl('https://app.example/cart', DEFAULT_URL_DENYLIST)).toBe('https://app.example/cart');
    });

    it('cuts a long url to the cap and adds no marker', () => {
        const long = 'https://app.example/search?q=' + 'a'.repeat(400);

        const result = breadcrumbUrl(long, DEFAULT_URL_DENYLIST);

        expect(result).toHaveLength(MAX_BREADCRUMB_URL_LENGTH);
        expect(result).toBe(long.slice(0, MAX_BREADCRUMB_URL_LENGTH));
        expect(result.endsWith('…')).toBe(false);
    });

    it('takes the credentials out', () => {
        expect(breadcrumbUrl('https://app.example/reset?token=abc123&page=2', DEFAULT_URL_DENYLIST)).toBe(
            'https://app.example/reset?token=[redacted]&page=2',
        );
    });

    it('redacts before it cuts, so a token past the cap cannot survive', () => {
        const url = 'https://app.example/reset?q=' + 'a'.repeat(300) + '&token=abc123';

        expect(breadcrumbUrl(url, DEFAULT_URL_DENYLIST)).not.toContain('abc123');
    });
});

describe('timelineEvents', () => {
    const glow = (microtime: number): Glow => ({
        name: 'g' + microtime,
        messageLevel: 'info',
        metaData: {},
        time: microtime,
        microtime,
    });

    it('merges glows and breadcrumbs into one list ordered by time', () => {
        const events = timelineEvents([glow(1), glow(3)], [crumb('browser_click', 2e9), crumb('browser_input', 4e9)]);

        expect(events.map((e) => e.type)).toEqual(['php_glow', 'browser_click', 'php_glow', 'browser_input']);
    });

    it('returns an empty list when there is nothing to show', () => {
        expect(timelineEvents([], [])).toEqual([]);
    });

    it('still returns the breadcrumbs when there are no glows', () => {
        expect(timelineEvents([], [crumb('browser_route_change', 1)])).toHaveLength(1);
    });
});
