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
 * One `installed` flag for the whole set, not one per method. XHR's `open` records what `send`
 * reads, so the set must never end up half patched.
 *
 * `install` and `uninstall` take the target per call. A captured target would have to resolve when
 * this module loads, and `XMLHttpRequest.prototype` does not exist under SSR.
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
         * Restore every method or none, because XHR's `open` records what `send` reads.
         *
         * A third party that wrapped on top of ours blocks the restore: `unfill` would find their
         * wrapper, not the original. `installed` stays true then, so the next `install` adds nothing
         * on top. Our wrappers stay in the chain and idle, because each one checks per call whether
         * anything still needs it.
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
