import { fill, unfill } from './fill';

type Wrapped<F> = F & { __flare_original__?: F };

/** One method to patch: its property name on the target, and how to build the wrapper. */
export type MethodPatch = { name: string; wrap: (original: unknown) => unknown };

/**
 * Own ONE `installed` flag across a set of methods patched on the same target
 * object, so a multi-method patch (e.g. XHR's open/setRequestHeader/send) installs
 * and restores atomically. A per-method flag, or none at all relying only on
 * `fill`'s own idempotency tag, is unsafe once more than one method shares state:
 * if a third party wraps just ONE of the methods on top of ours (e.g. `send`), the
 * others would restore to native while the leaked one stays live, corrupting the
 * state the methods share (XHR's `open` populates state that `send` depends on).
 *
 * The target is passed on every `install`/`uninstall` call rather than captured at
 * creation, since callers re-derive it fresh each time (`globalThis.fetch` may not
 * exist yet at SSR; `XMLHttpRequest.prototype` is looked up from the current global).
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
         * Restore every patched method on `target`, but only if ALL of them are still
         * cleanly restorable: for each, the current value is either not a function, or
         * still carries `__flare_original__` (our wrapper is still the top of its
         * chain). If ANY method has a third-party wrapper on top of ours, restore
         * NOTHING and keep `installed` true: our wrappers are all still live in their
         * chains and stay inert via their own `enableTracing` check, so tracing is
         * correctly off now and correctly resumes on the next `install` (which no-ops,
         * since the wrappers are already in place), with no double-wrapping.
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
