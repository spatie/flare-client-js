import { fill, unfill } from './fill';

type Wrapped<F> = F & { __flare_original__?: F };

export type MethodPatches<T> = { [K in keyof T]?: (original: NonNullable<T[K]>) => T[K] };

export type Patcher<T extends object> = {
    readonly installed: boolean;
    install(target: T, patches: MethodPatches<T>): void;
    uninstall(target: T): void;
};

/**
 * One `installed` flag for the whole set, not one per method: `open` remembers the URL that `send`
 * reads, so a half patched set is broken.
 */
export function createPatcher<T extends object>(): Patcher<T> {
    let installed = false;
    let names: (keyof T)[] = [];

    return {
        get installed(): boolean {
            return installed;
        },

        // The target comes in per call: `globalThis.fetch` may not exist yet under SSR.
        install(target: T, patches: MethodPatches<T>): void {
            if (installed) {
                return;
            }
            // Generic per key, so each wrapper stays typed against its own method.
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

        // All or nothing: when another library wrapped our wrapper we cannot restore the original,
        // so we put nothing back and keep `installed` true. That stops the next `install` from
        // stacking a second wrapper; ours stays in place but idle.
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
