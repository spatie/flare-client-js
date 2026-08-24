import {
    BrowserSpanEventType,
    defaultNowNano,
    redactUrlQuery,
    truncateBreadcrumbUrl,
    type Attributes,
} from '@flareapp/core';

import { currentHref, subscribeToNavigation, type RouteName } from '../instrumentation/navigation';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

/**
 * Records where a person went, as the url they came from and the url they landed on.
 *
 * We record when a navigation settles, not when it starts. React Router v7 opens a navigation before
 * the url is final, so an early record would say where the router was headed, not where it arrived.
 */
export class NavigationRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.RouteChange;

    /** Empty until the first navigation, so the opening entry carries no `from`. */
    private previousHref = '';

    constructor(private host: BreadcrumbHost) {
        this.onUrlChanged = this.onUrlChanged.bind(this);
        this.onNavigationSettle = this.onNavigationSettle.bind(this);
    }

    install(): () => void {
        // The timeline opens where the person landed, instead of starting halfway through the session.
        this.record(currentHref());

        return subscribeToNavigation({
            onUrlChanged: this.onUrlChanged,
            onNavigationSettle: this.onNavigationSettle,
        });
    }

    private onUrlChanged(): void {
        this.record(currentHref());
    }

    private onNavigationSettle(route: RouteName): void {
        this.record(route.url ?? currentHref(), route);
    }

    private record(href: string, route?: RouteName): void {
        const attributes: Attributes = { 'browser.route.to': this.clean(href) };
        if (this.previousHref) {
            // Left out on the first entry and after a reload: a missing value reads as "we do not
            // know", while an empty string reads as "the root page".
            attributes['browser.route.from'] = this.clean(this.previousHref);
        }
        if (route?.source === 'route') {
            attributes['flare.entry_point.handler.identifier'] = route.name;
            attributes['flare.route.source'] = route.source;
        }
        this.previousHref = href;
        this.host.record(this.type, attributes, defaultNowNano());
    }

    private clean(href: string): string {
        return truncateBreadcrumbUrl(redactUrlQuery(href, this.host.config().urlDenylist));
    }
}
