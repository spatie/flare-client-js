import { breadcrumbUrl, BrowserSpanEventType, defaultNowNano, type Attributes } from '@flareapp/core';

import { currentHref, subscribeToNavigation, type RouteName } from '../instrumentation/navigation';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export class NavigationRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.RouteChange;

    // Empty until the first navigation, so the first breadcrumb has no `from`.
    private previousHref = '';

    constructor(private host: BreadcrumbHost) {
        this.onUrlChanged = this.onUrlChanged.bind(this);
        this.onNavigationSettle = this.onNavigationSettle.bind(this);
    }

    install() {
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
            // A missing `from` means unknown. An empty string would read as the root page.
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
        return breadcrumbUrl(href, this.host.config().urlDenylist);
    }
}
