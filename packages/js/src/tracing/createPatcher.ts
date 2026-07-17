import { fill, unfill } from './fill';

type Wrapped<F> = F & { __flare_original__?: F };

/** One method to patch: its property name on the target, and how to build the wrapper. */
export type MethodPatch = { name: string; wrap: (original: unknown) => unknown };

/**
 * Own one `installed` flag across a set of methods patched on the same target object, so a
 * multi-method patch (e.g. XHR's open/setRequestHeader/send) installs and restores atomically.
 * A per-method flag (or relying only on `fill`'s idempotency tag) is unsafe once methods share
 * state: if a third party wraps just one method on top of ours, the others restore to native
 * while the leaked one stays live, corrupting shared state (XHR's `open` populates what `send`
 * depends on).
 *
 * Target is passed on every `install`/`uninstall` rather than captured at creation, since callers
 * re-derive it fresh (`globalThis.fetch` may not exist yet at SSR; `XMLHttpRequest.prototype` is
 * looked up from the current global).
 */
export function createPatcher() {
    let installed = false;
    let names: string[] = [];

    return {
        /** True once `install` has filled the methods and before a successful `uninstall`. */
        get installed(): boolean {
            return installed;
        },

        /** Fill every patch's method on `target`. No-op (does not re-fill anything) if already installed. */
        install(target: Record<string, unknown>, patches: readonly MethodPatch[]): void {
            if (installed) return;
            for (const { name, wrap } of patches) fill(target, name, wrap);
            names = patches.map((p) => p.name);
            installed = true;
        },

        /**
         * Restore every patched method on `target`, but only if all are still cleanly restorable:
         * each current value is either not a function, or still carries `__flare_original__` (our
         * wrapper is still the top of its chain). If any method has a third-party wrapper on top of
         * ours, restore nothing and keep `installed` true: our wrappers stay live in their chains
         * and inert via their own `enableTracing` check, so tracing is off now and resumes on the
         * next `install` (a no-op, since the wrappers are already in place) with no double-wrapping.
         */
        uninstall(target: Record<string, unknown>): void {
            if (!installed) return;
            const restorable = names.every((name) => {
                const current = target[name];
                return typeof current !== 'function' || Boolean((current as Wrapped<unknown>).__flare_original__);
            });
            if (!restorable) return;
            for (const name of names) unfill(target, name);
            installed = false;
        },
    };
}
