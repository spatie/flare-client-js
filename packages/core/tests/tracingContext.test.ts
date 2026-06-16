import { describe, expect, it } from 'vitest';

import { InMemoryActiveSpanHolder } from '../src/tracing/context';
import type { Span } from '../src/types';

const fakeSpan = (id: string) => ({ spanId: id }) as unknown as Span;

describe('InMemoryActiveSpanHolder', () => {
    it('exposes the active span only within withActive, then restores', () => {
        const holder = new InMemoryActiveSpanHolder();
        expect(holder.getActive()).toBeUndefined();

        const a = fakeSpan('a');
        let inside: Span | undefined;
        const result = holder.withActive(a, () => {
            inside = holder.getActive();
            return 'r';
        });

        expect(inside).toBe(a);
        expect(result).toBe('r');
        expect(holder.getActive()).toBeUndefined();
    });

    it('restores the previous active span when nested', () => {
        const holder = new InMemoryActiveSpanHolder();
        const a = fakeSpan('a');
        const b = fakeSpan('b');
        holder.withActive(a, () => {
            holder.withActive(b, () => {
                expect(holder.getActive()).toBe(b);
            });
            expect(holder.getActive()).toBe(a);
        });
        expect(holder.getActive()).toBeUndefined();
    });

    it('restores even when the callback throws', () => {
        const holder = new InMemoryActiveSpanHolder();
        expect(() =>
            holder.withActive(fakeSpan('a'), () => {
                throw new Error('boom');
            }),
        ).toThrow('boom');
        expect(holder.getActive()).toBeUndefined();
    });
});
