import { productById, products } from '../products';
import type {
    ApiProduct,
    CartLineInput,
    CartSummary,
    CartSummaryLine,
    OrderConfirmation,
    ProductDetail,
} from './types';

// The product whose price the mock pricing service drops. Adding it to the cart and checking out is
// what produces the showcase TypeError. See playgrounds/SCREENSHOTS.md.
export const PRICING_GAP_PRODUCT_ID = '7';

// Per-route latency. Deliberately uneven so a trace waterfall shows bars of different widths instead
// of a stack of identical stubs.
export const apiDelaysMs = {
    products: 180,
    product: 120,
    recommendations: 90,
    cartSummary: 60,
    checkout: 240,
} as const;

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toApiProduct = (product: (typeof products)[number]): ApiProduct => ({
    id: product.id,
    title: product.title,
    photographer: product.photographer,
    unsplashId: product.unsplashId,
    price: { amountCents: product.priceCents, currency: 'USD' },
});

const descriptions: Record<string, string> = {
    default: 'Archival pigment print on cotton rag, signed and numbered by the photographer.',
};

export const listProducts = (): { products: ApiProduct[] } => ({
    products: products.map(toApiProduct),
});

export const getProduct = (id: string): ProductDetail | null => {
    const product = productById(id);
    if (!product) return null;

    return {
        product: toApiProduct(product),
        description: descriptions[id] ?? descriptions.default,
    };
};

// Three other prints, picked deterministically so screenshots stay reproducible.
export const getRecommendations = (excludeId?: string): { products: ApiProduct[] } => ({
    products: products
        .filter((product) => product.id !== excludeId)
        .slice(0, 3)
        .map(toApiProduct),
});

export const getCartSummary = (lines: CartLineInput[]): CartSummary => ({
    currency: 'USD',
    lines: lines.flatMap((line) => {
        const product = productById(line.productId);
        if (!product) return [];

        const summary = {
            productId: product.id,
            title: product.title,
            quantity: line.quantity,
        };

        if (product.id === PRICING_GAP_PRODUCT_ID) {
            return [summary as CartSummaryLine];
        }

        return [{ ...summary, price: { amountCents: product.priceCents, currency: 'USD' } } as CartSummaryLine];
    }),
});

export const createOrder = (totalCents: number): OrderConfirmation => ({
    orderId: `ord_${String(totalCents).padStart(6, '0')}`,
    totalCents,
});
