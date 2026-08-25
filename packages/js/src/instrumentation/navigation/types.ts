export type RouteName = {
    name: string;
    source: 'route' | 'url';
    /** Where the navigation ends. Set on a redirect so the final url is reported; leave out to keep
     *  the url the root opened with. */
    url?: string;
};

export type NavigationSource = {
    startNavigation(opts?: { path?: string; url?: string; hold?: boolean }): void;
    setActiveRouteName(route: RouteName): void;
    settleNavigation(route: RouteName): void;
    unregister(): void;
};

// Tracing and breadcrumbs both subscribe; neither knows about the other.
export type NavigationSubscriber = {
    /** The url changed and no router is registered. */
    onUrlChanged?(path: string): void;
    onNavigationStart?(opts: { path: string; url?: string; hold?: boolean }): void;
    onRouteName?(route: RouteName, owner: object): void;
    onNavigationSettle?(route: RouteName, owner: object): void;
    onSourceUnregistered?(): void;
};
