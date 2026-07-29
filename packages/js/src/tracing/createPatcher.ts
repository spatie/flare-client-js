import { fill, unfill } from './fill';

type Wrapped<F> = F & { __flare_original__?: F };

export type MethodPatch = { name: string; wrap: (original: unknown) => unknown };

/**
 * One `installed` flag across a set of methods on the same target, so a multi-method patch (XHR's
 * open/setRequestHeader/send) installs and restores as a unit. A flag per method is unsafe once the
 * methods share state: a third party wrapping only one of them would leave that one patched while
 * the rest went back to native, and XHR's `open` records what `send` reads.
 *
 * Target is passed per call rather than captured, because callers look it up fresh
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
         * Restores only if every method can still be restored cleanly, meaning our wrapper is still the
         * outermost one. If a third party wrapped ours, restore nothing and stay `installed`: our
         * wrappers stay in place but do nothing, thanks to their own `enableTracing` check, so the next
         * `install` is a no-op instead of adding a second layer of wrapping.
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
