import { fill, unfill } from './fill';

type Wrapped<F> = F & { __flare_original__?: F };

export type MethodPatch = { name: string; wrap: (original: unknown) => unknown };

/**
 * One `installed` flag across a set of methods on the same target, so a multi-method patch (XHR's
 * open/setRequestHeader/send) installs and restores atomically. Per-method flags are unsafe once the
 * methods share state: a third party wrapping only one of them would leave that one live while the
 * rest restored to native, and XHR's `open` populates what `send` reads.
 *
 * Target is passed per call rather than captured, because callers re-derive it fresh
 * (`globalThis.fetch` may not exist yet under SSR).
 */
export function createPatcher() {
    let installed = false;
    let names: string[] = [];

    return {
        get installed(): boolean {
            return installed;
        },

        install(target: Record<string, unknown>, patches: readonly MethodPatch[]): void {
            if (installed) {
                return;
            }
            for (const { name, wrap } of patches) {
                fill(target, name, wrap);
            }
            names = patches.map((p) => p.name);
            installed = true;
        },

        /**
         * Restores only if every method is still cleanly restorable, i.e. our wrapper is still the top
         * of its chain. With a third-party wrapper on top of ours, restore nothing and stay `installed`:
         * our wrappers remain in the chain but go inert via their own `enableTracing` check, so the next
         * `install` is a no-op rather than a second layer of wrapping.
         */
        uninstall(target: Record<string, unknown>): void {
            if (!installed) {
                return;
            }
            const restorable = names.every((name) => {
                const current = target[name];
                return typeof current !== 'function' || Boolean((current as Wrapped<unknown>).__flare_original__);
            });
            if (!restorable) {
                return;
            }
            for (const name of names) {
                unfill(target, name);
            }
            installed = false;
        },
    };
}
