import { browser } from '$app/environment';

const KEY = 'flare-playground-cart';

export type CartLine = { productId: string; quantity: number };

const read = (): CartLine[] => {
    if (!browser) return [];
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const state = $state<{ lines: CartLine[] }>({ lines: read() });

const persist = (): void => {
    if (!browser) return;
    localStorage.setItem(KEY, JSON.stringify(state.lines));
};

export const cart = {
    get lines(): CartLine[] {
        return state.lines;
    },
    get count(): number {
        return state.lines.reduce((sum, line) => sum + line.quantity, 0);
    },
    add(productId: string): void {
        const existing = state.lines.find((line) => line.productId === productId);
        if (existing) existing.quantity += 1;
        else state.lines.push({ productId, quantity: 1 });
        persist();
    },
    remove(productId: string): void {
        state.lines = state.lines.filter((line) => line.productId !== productId);
        persist();
    },
    clear(): void {
        state.lines = [];
        persist();
    },
};
