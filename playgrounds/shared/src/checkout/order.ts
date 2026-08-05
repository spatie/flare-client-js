import { shopApi } from '../api/client';
import type { CartSummary, OrderConfirmation } from '../api/types';
import { calculateOrderTotal } from './pricing';

export type OrderSummary = {
    totalCents: number;
    itemCount: number;
};

export const buildOrderSummary = (summary: CartSummary): OrderSummary => ({
    totalCents: calculateOrderTotal(summary.lines),
    itemCount: summary.lines.reduce((count, line) => count + line.quantity, 0),
});

/**
 * The showcase order path. With the pricing-gap product in the cart this throws out of
 * `calculateOrderTotal` before the checkout request is ever made, which is the error every
 * playground's checkout page reports.
 */
export const placeOrder = (summary: CartSummary): Promise<OrderConfirmation> =>
    shopApi.checkout(buildOrderSummary(summary).totalCents);
