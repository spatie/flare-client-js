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

const write = (lines: CartLine[]): void => {
    localStorage.setItem(KEY, JSON.stringify(lines));
    for (const listener of [...listeners]) listener();
};

export const cart = {
    lines: (): CartLine[] => read(),
    add: (productId: string): void => {
        const lines = read();
        const existing = lines.find((line) => line.productId === productId);
        if (existing) existing.quantity += 1;
        else lines.push({ productId, quantity: 1 });
        write(lines);
    },
    remove: (productId: string): void => {
        write(read().filter((line) => line.productId !== productId));
    },
    clear: (): void => write([]),
    count: (): number => read().reduce((sum, line) => sum + line.quantity, 0),
    subscribe: (listener: Listener): (() => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
};
