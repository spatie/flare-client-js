export type Unsubscribe = () => void;

/**
 * Refcounts the holders of one patch. The patch goes on when the first holder arrives and comes off
 * when the last one leaves, so with every feature switched off the browser globals are untouched.
 * A release is idempotent: calling it twice must not take the patch off while another holder is live.
 */
export function createPatchLifecycle(patch: { install(): void; uninstall(): void }): { retain(): Unsubscribe } {
    let holders = 0;

    return {
        retain(): Unsubscribe {
            if (++holders === 1) {
                patch.install();
            }
            let released = false;
            return () => {
                if (released) {
                    return;
                }
                released = true;
                if (--holders === 0) {
                    patch.uninstall();
                }
            };
        },
    };
}

export type HandlerSet<H> = {
    add(handler: H): Unsubscribe;
    each(run: (handler: H) => void): void;
    /** Remove every handler and release their patch holds. For tests and full teardowns. */
    clear(): void;
    readonly size: number;
};

/**
 * A set of handlers over one patch lifecycle. `each` iterates a copy, because a handler is allowed to
 * unsubscribe itself while it runs, and swallows a throw per handler so one bad listener cannot cost
 * the others their notification or reach the host app.
 */
export function createHandlerSet<H>(lifecycle: { retain(): Unsubscribe }): HandlerSet<H> {
    const releases = new Map<H, Unsubscribe>();

    return {
        add(handler: H): Unsubscribe {
            // The first registrant owns the handler. A second add() of the same reference
            // is absorbed to prevent its unsubscribe from removing a handler the first caller still needs.
            if (releases.has(handler)) {
                return () => {};
            }
            const release = lifecycle.retain();
            releases.set(handler, release);
            return () => {
                if (releases.delete(handler)) {
                    release();
                }
            };
        },
        each(run: (handler: H) => void): void {
            for (const handler of [...releases.keys()]) {
                try {
                    run(handler);
                } catch {
                    // instrumentation never breaks the host
                }
            }
        },
        clear(): void {
            for (const release of [...releases.values()]) {
                release();
            }
            releases.clear();
        },
        get size(): number {
            return releases.size;
        },
    };
}
