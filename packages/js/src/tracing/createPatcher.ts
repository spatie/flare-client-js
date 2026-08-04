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
 * One `installed` flag for the whole patch set, not per method: XHR's `open` records what `send` reads,
 * so a third party wrapping one of them must never leave the set half patched.
 *
 * Target is passed per call, not captured, because callers look it up fresh (`globalThis.fetch` may not
 * exist yet under SSR).
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
         * All or nothing: if a third party wrapped ours, restore nothing and stay `installed`, so the next
         * `install` is a no-op instead of adding a second layer. Our wrappers stay in place but idle, because
         * they check `enableTracing` themselves.
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
