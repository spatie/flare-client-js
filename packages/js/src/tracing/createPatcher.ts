import { fill, unfill } from './fill';

type Wrapped<F> = F & { __flare_original__?: F };

/** One wrapper factory per patched method, each typed against that method alone. */
export type MethodPatches<T> = { [K in keyof T]?: (original: NonNullable<T[K]>) => T[K] };

export type Patcher<T extends object> = {
    readonly installed: boolean;
    install(target: T, patches: MethodPatches<T>): void;
    uninstall(target: T): void;
};

/**
 * One `installed` flag across a set of methods on the same target, so a multi-method patch (XHR's
 * open/setRequestHeader/send) installs and restores as a unit. A flag per method is unsafe once the
 * methods share state: a third party wrapping only one of them would leave that one patched while
 * the rest went back to native, and XHR's `open` records what `send` reads.
 *
 * Target is passed per call rather than captured, because callers look it up fresh
 * (`globalThis.fetch` may not exist yet under SSR).
 */
export function createPatcher<T extends object>(): Patcher<T> {
    let installed = false;
    let names: (keyof T)[] = [];

    return {
        get installed(): boolean {
            return installed;
        },

        install(target: T, patches: MethodPatches<T>): void {
            if (installed) {
                return;
            }
            // Generic over one key at a time: that is what keeps each wrapper correlated with its
            // own method instead of the union of all of them.
            function applyOne<K extends keyof T>(name: K): void {
                const wrap = patches[name];
                if (wrap) {
                    fill(target, name, wrap);
                }
            }
            names = Object.keys(patches) as (keyof T)[];
            for (const name of names) {
                applyOne(name);
            }
            installed = true;
        },

        /**
         * Restores only if every method can still be restored cleanly, meaning our wrapper is still the
         * outermost one. If a third party wrapped ours, restore nothing and stay `installed`: our
         * wrappers stay in place but do nothing, thanks to their own `enableTracing` check, so the next
         * `install` is a no-op instead of adding a second layer of wrapping.
         */
        uninstall(target: T): void {
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
