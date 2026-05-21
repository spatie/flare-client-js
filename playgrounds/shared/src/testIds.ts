export const testIds = {
    productGrid: 'product-grid',
    productCard: (id: string) => `product-card-${id}`,
    addToCart: (id: string) => `add-to-cart-${id}`,
    cartCount: 'cart-count',
    cartItem: (id: string) => `cart-item-${id}`,
    checkoutSubmit: 'checkout-submit',
    confirmation: 'confirmation',
    brokenTrigger: (scenarioId: string) => `trigger-${scenarioId}`,
    boundaryFallback: 'boundary-fallback',
    boundaryReset: 'boundary-reset',
} as const;
