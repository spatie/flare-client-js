// One table of the ways an app can be served, shared by every router suite. Each suite boots a real
// router per case and checks that the route name and url match what the address bar shows, so a
// router that drops the base (or the `#`) cannot pass in one framework and fail in another.
export type RouterBaseCase = {
    title: string;
    mode: 'history' | 'hash';
    /** History mode: the router's basename. Hash mode: the page path in front of the `#`. */
    base: string;
    /** The prefix the route name gets with `includeRouterBase`. */
    expectedBase: string;
};

export const ROUTER_BASE_CASES: RouterBaseCase[] = [
    { title: 'history, no base', mode: 'history', base: '/', expectedBase: '' },
    { title: 'history, base', mode: 'history', base: '/agent/certificates', expectedBase: '/agent/certificates' },
    {
        title: 'history, base with trailing slash',
        mode: 'history',
        base: '/agent/certificates/',
        expectedBase: '/agent/certificates',
    },
    { title: 'hash, site root', mode: 'hash', base: '/', expectedBase: '/#' },
    { title: 'hash, sub path', mode: 'hash', base: '/agent/certificates/', expectedBase: '/agent/certificates/#' },
];

/** The address bar path for a router path (`/product/p01`) in this case. */
export function addressBarPath(testCase: RouterBaseCase, routerPath: string): string {
    if (testCase.mode === 'hash') {
        return `${testCase.base}#${routerPath}`;
    }
    const base = testCase.base.replace(/\/+$/, '');
    return routerPath === '/' && base ? `${base}/` : base + routerPath;
}

/** Puts the browser on the address bar path, so a router booted next starts there. */
export function visitAddressBarPath(testCase: RouterBaseCase, routerPath: string): void {
    window.history.replaceState({}, '', addressBarPath(testCase, routerPath));
}

export function absoluteAddressBarUrl(testCase: RouterBaseCase, routerPath: string): string {
    return `${window.location.origin}${addressBarPath(testCase, routerPath)}`;
}
