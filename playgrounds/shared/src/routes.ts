export const routes = {
    products: '/',
    product: '/product/:id',
    cart: '/cart',
    checkout: '/checkout',
    confirmation: '/confirmation',
    broken: '/broken',
    serverError: '/server-error',
} as const;

export const productPath = (id: string): string => `/product/${id}`;
