import { useSyncExternalStore } from 'react';

const KEY = 'flare-playground-cart';

export type CartLine = { productId: string; quantity: number };

type Listener = () => void;
const listeners = new Set<Listener>();

const read = (): CartLine[] => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

// Cache snapshots so useSyncExternalStore receives a stable reference between
// notifications. Reading on every getSnapshot would return a fresh array each
// time and trigger React's infinite loop guard.
let linesSnapshot: CartLine[] = read();
let countSnapshot: number = linesSnapshot.reduce((sum, line) => sum + line.quantity, 0);

const write = (lines: CartLine[]): void => {
    localStorage.setItem(KEY, JSON.stringify(lines));
    linesSnapshot = lines;
    countSnapshot = lines.reduce((sum, line) => sum + line.quantity, 0);
    for (const listener of [...listeners]) listener();
};

const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const cart = {
    lines: (): CartLine[] => linesSnapshot,
    add: (productId: string): void => {
        const lines = [...linesSnapshot];
        const existing = lines.find((line) => line.productId === productId);
        if (existing) existing.quantity += 1;
        else lines.push({ productId, quantity: 1 });
        write(lines);
    },
    remove: (productId: string): void => {
        write(linesSnapshot.filter((line) => line.productId !== productId));
    },
    clear: (): void => write([]),
    count: (): number => countSnapshot,
    subscribe,
};

export const useCart = (): CartLine[] =>
    useSyncExternalStore(
        subscribe,
        () => linesSnapshot,
        () => linesSnapshot
    );

export const useCartCount = (): number =>
    useSyncExternalStore(
        subscribe,
        () => countSnapshot,
        () => countSnapshot
    );
