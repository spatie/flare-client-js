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

        // We pass in the target (XMLHttpRequest.prototype for example), because if we would resolve them when this module loads
        // instead of passing them in when something calls this function, we might run into trouble under SSR.
        install(target: T, patches: MethodPatches<T>): void {
            if (installed) {
                return;
            }
            // Inside the loop `name` is every key at once, so `fill` cannot match a wrapper to its
            // method. A single type parameter narrows it to one.
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

        // Put back every method on the target, or none.
        // Another library can wrap our wrapper. If that happens, we cannot find the original target we wrapped,
        // so we put nothing back and keep `installed` true. That stops the next `install` from adding a second wrapper.
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
