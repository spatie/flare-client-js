import { describe, expect, it } from 'vitest';

import { InMemoryActiveSpanHolder } from '../src/tracing/context';
import type { Span } from '../src/types';

const fakeSpan = (id: string): Span =>
    ({ traceId: 't', spanId: id, parentSpanId: null, name: id, isRecording: true }) as unknown as Span;

describe('InMemoryActiveSpanHolder active root', () => {
    it('getActive falls back to the active root when no withActive scope is present', () => {
        const holder = new InMemoryActiveSpanHolder();
        const root = fakeSpan('root');
        expect(holder.getActive()).toBeUndefined();

        holder.setActiveRoot(root);
        expect(holder.getActive()).toBe(root);

        holder.setActiveRoot(undefined);
        expect(holder.getActive()).toBeUndefined();
    });

    it('a withActive scope takes precedence over the root, restoring the root afterward', () => {
        const holder = new InMemoryActiveSpanHolder();
        const root = fakeSpan('root');
        const scoped = fakeSpan('scoped');
        holder.setActiveRoot(root);

        const seenInside = holder.withActive(scoped, () => holder.getActive());
        expect(seenInside).toBe(scoped);
        expect(holder.getActive()).toBe(root); // restored to root, not undefined
    });
});
