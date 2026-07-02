import type { Span } from '../types';

export interface ActiveSpanHolder {
    getActive(): Span | undefined;
    // Runs `fn` with `span` as the active span, restoring the prior active span
    // afterward. Modeled as a callback (not a bare setter) so a Node holder can
    // back it with AsyncLocalStorage.run(...) to preserve async-scoped context.
    withActive<T>(span: Span, fn: () => T): T;
    // Sets a persistent "active root" that getActive() falls back to when no
    // withActive scope is on the stack. Used by long-lived pageload/navigation
    // roots so child spans (e.g. fetches) auto-parent to them. NOTE: this is a
    // required interface method; adding it is a breaking change for any external
    // ActiveSpanHolder implementer, so it warrants a major-version note when
    // @flareapp/core is next released.
    setActiveRoot(span: Span | undefined): void;
}

export class InMemoryActiveSpanHolder implements ActiveSpanHolder {
    private active: Span | undefined;
    private root: Span | undefined;

    getActive(): Span | undefined {
        return this.active ?? this.root;
    }

    withActive<T>(span: Span, fn: () => T): T {
        const previous = this.active;
        this.active = span;
        try {
            return fn();
        } finally {
            this.active = previous;
        }
    }

    setActiveRoot(span: Span | undefined): void {
        this.root = span;
    }
}
