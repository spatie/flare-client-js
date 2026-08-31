import type { ApiProduct, CartLineInput, CartSummary, OrderConfirmation, ProductDetail } from './types';

const readJson = async <T>(response: Response): Promise<T> => {
    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} for ${response.url}`);
    }

    return (await response.json()) as T;
};

const postJson = <T>(url: string, body: unknown): Promise<T> =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }).then((response) => readJson<T>(response));

// The catalog calls every playground page makes. Keeping them here means one set of URLs shows up in
// the trace waterfall no matter which framework produced it.
export const shopApi = {
    products: (): Promise<ApiProduct[]> =>
        fetch('/api/products')
            .then((response) => readJson<{ products: ApiProduct[] }>(response))
            .then((body) => body.products),

    product: (id: string): Promise<ProductDetail> =>
        fetch(`/api/products/${id}`).then((response) => readJson<ProductDetail>(response)),

    recommendations: (excludeId?: string): Promise<ApiProduct[]> =>
        fetch(`/api/recommendations${excludeId ? `?exclude=${excludeId}` : ''}`)
            .then((response) => readJson<{ products: ApiProduct[] }>(response))
            .then((body) => body.products),

    cartSummary: (lines: CartLineInput[]): Promise<CartSummary> =>
        postJson<CartSummary>('/api/cart/summary', { lines }),

    checkout: (totalCents: number): Promise<OrderConfirmation> =>
        postJson<OrderConfirmation>('/api/checkout', { totalCents }),
};
