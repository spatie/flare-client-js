// The e2e suite sets this global with `page.addInitScript` to boot a playground with a router base or a
// hash router. Without it, every playground keeps its normal history router at `/`.
export const ROUTER_SETUP_GLOBAL = '__flarePlaygroundRouter';

export type PlaygroundRouterSetup = {
    mode: 'history' | 'hash';
    /** History mode: the router basename. Hash mode: the page path in front of the `#`. */
    base: string;
    includeRouterBase: boolean;
};

export const playgroundRouterSetup = (): PlaygroundRouterSetup => {
    const setup =
        typeof window === 'undefined'
            ? undefined
            : (window as unknown as Record<string, Partial<PlaygroundRouterSetup> | undefined>)[ROUTER_SETUP_GLOBAL];

    return {
        mode: setup?.mode ?? 'history',
        base: setup?.base ?? '/',
        includeRouterBase: setup?.includeRouterBase ?? false,
    };
};
