type Wrapped<F> = F & { __flare_original__?: F };

/**
 * Replace `source[name]` with `replacer(original)`, tagging the wrapper with a
 * non-enumerable `__flare_original__` so the patch is idempotent and reversible.
 * Ported from Sentry's `fill` (packages/core/src/utils/object.ts), minus the
 * prototype/own-property copying we do not need for `fetch`.
 */
export function fill<T extends Record<string, unknown>, K extends keyof T>(
    source: T,
    name: K,
    replacer: (original: T[K]) => T[K],
): void {
    const original = source[name];
    if (typeof original !== 'function') return;
    if ((original as Wrapped<unknown>).__flare_original__) return; // already patched

    const wrapped = replacer(original) as Wrapped<T[K]>;
    Object.defineProperty(wrapped, '__flare_original__', {
        value: original,
        enumerable: false,
        configurable: true,
        writable: true,
    });
    source[name] = wrapped;
}

/** Restore a previously `fill`ed property to its original. Safe if never filled. */
export function unfill<T extends Record<string, unknown>, K extends keyof T>(source: T, name: K): void {
    const current = source[name] as Wrapped<T[K]>;
    if (current && current.__flare_original__) source[name] = current.__flare_original__;
}
