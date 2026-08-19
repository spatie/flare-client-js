export type JourneyGlow = {
    name: string;
    data: Record<string, unknown>;
};

/**
 * The breadcrumb trail the showcase error arrives with. Defined once so every playground reports the
 * same journey, and typed structurally so this package does not need to depend on the SDK.
 */
export type GlowTarget = {
    glow(name: string, level?: 'info', data?: Record<string, unknown>): unknown;
};

export const recordGlow = (target: GlowTarget, glow: JourneyGlow): void => {
    target.glow(glow.name, 'info', glow.data);
};

export const journeyGlows = {
    viewedProduct: (product: { id: string; title: string }): JourneyGlow => ({
        name: 'Viewed product',
        data: { productId: product.id, title: product.title },
    }),
    addedToCart: (productId: string, cartSize: number): JourneyGlow => ({
        name: 'Added product to cart',
        data: { productId, cartSize },
    }),
    openedCheckout: (itemCount: number): JourneyGlow => ({
        name: 'Opened checkout',
        data: { itemCount },
    }),
};

/** The signed-in shopper every playground reports as, so the error carries a user. */
export const showcaseUser = {
    id: 'usr_8123',
    email: 'iris.dewitte@example.com',
    fullName: 'Iris De Witte',
    plan: 'studio',
};
