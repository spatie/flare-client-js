import { afterEach, describe, expect, it } from 'vitest';

import { isNativeFetch, supportsNativeFetch } from '../src/tracing/supportsNativeFetch';

describe('isNativeFetch', () => {
    it('is true for a genuinely native builtin', () => {
        expect(isNativeFetch(Math.max)).toBe(true);
    });

    it('is false for a plain JS wrapper', () => {
        const wrapper = (x: number) => x;
        expect(isNativeFetch(wrapper)).toBe(false);
    });

    it('is not fooled by a wrapper that overrides its own toString', () => {
        const spoof = (x: number) => x;
        spoof.toString = () => 'function fetch() { [native code] }';
        expect(isNativeFetch(spoof)).toBe(false); // prototype toString ignores the override
    });

    it('is false for non-functions', () => {
        expect(isNativeFetch(undefined)).toBe(false);
        expect(isNativeFetch(42)).toBe(false);
    });
});

describe('supportsNativeFetch iframe probe', () => {
    const realFetch = globalThis.fetch;
    const realDocument = (globalThis as { document?: unknown }).document;

    afterEach(() => {
        globalThis.fetch = realFetch;
        (globalThis as { document?: unknown }).document = realDocument;
    });

    // A non-native fetch is what pushes supportsNativeFetch onto the iframe fallback path.
    function stubNonNativeFetch(): void {
        globalThis.fetch = ((): void => {}) as unknown as typeof fetch;
    }

    function stubDocument(iframe: Record<string, unknown>): { attached: unknown[] } {
        const attached: unknown[] = [];
        iframe.remove = (): void => {
            const at = attached.indexOf(iframe);
            if (at !== -1) {
                attached.splice(at, 1);
            }
        };
        (globalThis as { document?: unknown }).document = {
            createElement: () => iframe,
            head: { appendChild: (node: unknown) => attached.push(node) },
        };
        return { attached };
    }

    it('removes the probe iframe when reading contentWindow throws', () => {
        stubNonNativeFetch();
        const iframe: Record<string, unknown> = {};
        Object.defineProperty(iframe, 'contentWindow', {
            get(): never {
                throw new Error('blocked');
            },
        });
        const { attached } = stubDocument(iframe);

        expect(supportsNativeFetch()).toBe(false);
        expect(attached).toHaveLength(0);
    });

    it('does not throw into the caller when appending the probe fails', () => {
        stubNonNativeFetch();
        (globalThis as { document?: unknown }).document = {
            createElement: () => ({}),
            head: {
                appendChild: (): never => {
                    throw new Error('head is frozen');
                },
            },
        };

        expect(() => supportsNativeFetch()).not.toThrow();
        expect(supportsNativeFetch()).toBe(false);
    });
});
