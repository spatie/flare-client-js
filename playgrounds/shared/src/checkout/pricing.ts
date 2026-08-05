import type { CartSummaryLine, Money } from '../api/types';

/** Tolerates the missing price the cart page has to render anyway. */
export const formatMoney = (money: Money | undefined): string =>
    money ? `$${(money.amountCents / 100).toFixed(2)}` : 'Price unavailable';

/**
 * Trusts the catalog contract that every line carries a price. One product comes back without one,
 * which is where the showcase TypeError is thrown.
 */
export const lineTotalCents = (line: CartSummaryLine): number => line.price.amountCents * line.quantity;

export const calculateOrderTotal = (lines: CartSummaryLine[]): number =>
    lines.reduce((total, line) => total + lineTotalCents(line), 0);

/** What the cart page shows. Skips unpriced lines so the page still renders instead of throwing. */
export const displayTotalCents = (lines: CartSummaryLine[]): number =>
    lines.reduce((total, line) => (line.price ? total + line.price.amountCents * line.quantity : total), 0);
