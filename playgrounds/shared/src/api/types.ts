export type Money = { amountCents: number; currency: 'USD' };

export type ApiProduct = {
    id: string;
    title: string;
    photographer: string;
    unsplashId: string;
    price: Money;
};

export type ProductDetail = {
    product: ApiProduct;
    description: string;
};

export type CartLineInput = { productId: string; quantity: number };

// `price` is not optional on purpose. The catalog contract promises it on every line, but the mock
// pricing service drops it for one product — the type/runtime gap is what the checkout error shows.
export type CartSummaryLine = {
    productId: string;
    title: string;
    quantity: number;
    price: Money;
};

export type CartSummary = {
    lines: CartSummaryLine[];
    currency: 'USD';
};

export type OrderConfirmation = {
    orderId: string;
    totalCents: number;
};
