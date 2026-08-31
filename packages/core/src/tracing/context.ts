import type { Span } from '../types';

export interface ActiveSpanHolder {
    getActive(): Span | undefined;
    /**
     * Runs `fn` with `span` active, then restores the previous active span. Takes a callback, not a
     * setter, so a Node holder can implement it with `AsyncLocalStorage.run(...)`.
     */
    withActive<T>(span: Span, fn: () => T): T;
    /**
     * Fallback span that getActive() returns when no withActive scope is active. Long-lived
     * pageload/navigation roots use it so child spans auto-parent to them. Optional.
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
