import { expect, type Page } from '@playwright/test';

import type { FakeFlareRecord } from '../fake-flare-server/types';

export type Breadcrumb = {
    type: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number | null;
    attributes: Record<string, unknown>;
};

type FakeFlare = {
    waitForReport(options?: { predicate?: (record: FakeFlareRecord) => boolean }): Promise<FakeFlareRecord>;
};

export function eventsOf(record: FakeFlareRecord): Breadcrumb[] {
    return ((record.bodyJson as { events?: Breadcrumb[] } | null)?.events ?? []) as Breadcrumb[];
}

export function ofType(record: FakeFlareRecord, type: string): Breadcrumb[] {
    return eventsOf(record).filter((event) => event.type === type);
}

// Waits for a report that already carries the breadcrumb we care about.
export function reportWith(fakeFlare: FakeFlare, type: string): Promise<FakeFlareRecord> {
    return fakeFlare.waitForReport({
        predicate: (record) => ofType(record, type).length > 0,
    });
}

// Starts with a full page load, so the breadcrumb buffer holds only what this call produces.
export async function throwFrom(page: Page, testId: string): Promise<void> {
    await page.goto('/broken');
    await page.waitForLoadState('networkidle');
    await page.getByTestId(testId).click();
}

// Reaches `/broken` through the nav link: a `page.goto` would reload the document and empty the buffer.
export async function throwWithoutReload(page: Page, testId: string): Promise<void> {
    await page.getByRole('link', { name: 'Broken' }).first().click();
    await page.waitForURL('**/broken');
    await page.getByTestId(testId).click();
}

export function expectOrderedByTime(events: Breadcrumb[]): void {
    const times = events.map((event) => event.startTimeUnixNano);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
}

// Runs per playground rather than once, because each router reaches the navigation seam its own way.
export async function runRouteChangeScenario(page: Page, fakeFlare: FakeFlare, cartPath = '/cart'): Promise<void> {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('link', { name: 'Cart' }).first().click();
    await page.waitForURL(`**${cartPath}`);

    await throwWithoutReload(page, 'trigger-sync-throw');
    const report = await reportWith(fakeFlare, 'browser_route_change');

    const routeChanges = ofType(report, 'browser_route_change');
    expect(routeChanges.length).toBeGreaterThan(1);

    // The opening entry says where the session started, so it carries no `from`.
    expect(routeChanges[0].attributes['browser.route.from']).toBeUndefined();
    expect(routeChanges[0].attributes['browser.route.to']).toContain('/');

    const toCart = routeChanges.find((event) => String(event.attributes['browser.route.to']).includes(cartPath));
    expect(toCart, 'a route change into the cart').toBeDefined();
    expect(String(toCart!.attributes['browser.route.from'])).not.toContain(cartPath);

    expectOrderedByTime(eventsOf(report));
}
