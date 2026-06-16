import type { Span } from '../types';

export interface ActiveSpanHolder {
    getActive(): Span | undefined;
    // Runs `fn` with `span` as the active span, restoring the prior active span
    // afterward. Modeled as a callback (not a bare setter) so a Node holder can
    // back it with AsyncLocalStorage.run(...) to preserve async-scoped context.
    withActive<T>(span: Span, fn: () => T): T;
}

export class InMemoryActiveSpanHolder implements ActiveSpanHolder {
    private active: Span | undefined;

    getActive(): Span | undefined {
        return this.active;
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
}
