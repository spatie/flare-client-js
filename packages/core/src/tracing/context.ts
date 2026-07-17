import type { Span } from '../types';

export interface ActiveSpanHolder {
    getActive(): Span | undefined;
    /**
     * Run `fn` with `span` active, restoring the prior active span afterward. A callback (not a bare setter) so a Node
     * holder can back it with AsyncLocalStorage.run(...) to preserve async-scoped context.
     */
    withActive<T>(span: Span, fn: () => T): T;
    /**
     * Persistent "active root" that getActive() falls back to when no withActive scope is on the stack. Used by
     * long-lived pageload/navigation roots so child spans (e.g. fetches) auto-parent to them. Optional; a holder that
     * omits it simply has no active-root support.
     */
    setActiveRoot?(span: Span | undefined): void;
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
