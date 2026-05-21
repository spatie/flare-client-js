import { computed, ref, type ComputedRef, type Ref } from 'vue';

const KEY = 'flare-playground-cart';

export type CartLine = { productId: string; quantity: number };

const readFromStorage = (): CartLine[] => {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const lines: Ref<CartLine[]> = ref(readFromStorage());

const persist = (next: CartLine[]): void => {
    lines.value = next;
    localStorage.setItem(KEY, JSON.stringify(next));
};

const count: ComputedRef<number> = computed(() => lines.value.reduce((sum, line) => sum + line.quantity, 0));

const add = (productId: string): void => {
    const next = lines.value.map((line) => ({ ...line }));
    const existing = next.find((line) => line.productId === productId);
    if (existing) existing.quantity += 1;
    else next.push({ productId, quantity: 1 });
    persist(next);
};

const remove = (productId: string): void => {
    persist(lines.value.filter((line) => line.productId !== productId));
};

const clear = (): void => persist([]);

export const useCart = () => ({
    lines,
    count,
    add,
    remove,
    clear,
});
