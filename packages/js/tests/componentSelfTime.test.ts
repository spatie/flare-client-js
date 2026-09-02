import { afterEach, describe, expect, it } from 'vitest';

import { resetComponentSelfTime, takeSelfTime, trackChildInterval } from '../src/tracing/roots/componentSelfTime';

const ms = (value: number): number => value * 1e6;

// What recordComponentSpan does for one component: take its own self time, then file its interval
// under its parent.
function record(spanId: string, parentSpanId: string, start: number, end: number): number {
    const selfTime = takeSelfTime(spanId, ms(start), ms(end));
    trackChildInterval(parentSpanId, ms(start), ms(end));
    return selfTime;
}

describe('component self time', () => {
    afterEach(() => {
        resetComponentSelfTime();
    });

    it('gives a childless component its full duration', () => {
        expect(takeSelfTime('leaf', ms(5), ms(20))).toBe(ms(15));
    });

    // A -> B -> D, A -> C. React captures every start during render (A, B, D, C) and ends them all
    // during commit (D, B, C, A), so B and C overlap.
    it('subtracts the union of overlapping siblings, not their sum', () => {
        expect(record('D', 'B', 5, 20)).toBe(ms(15));
        expect(record('B', 'A', 2, 22)).toBe(ms(5));
        expect(record('C', 'A', 9, 24)).toBe(ms(15));

        // B and C last 35 ms together but cover only [2, 24], so A keeps 4 ms of its own.
        expect(takeSelfTime('A', ms(0), ms(26))).toBe(ms(4));
    });

    // Vue mounts depth-first, so B closes before C opens and the self times add up to A's duration.
    it('subtracts both siblings when they do not overlap', () => {
        expect(record('D', 'B', 4, 12)).toBe(ms(8));
        expect(record('B', 'A', 2, 14)).toBe(ms(4));
        expect(record('C', 'A', 16, 24)).toBe(ms(8));

        expect(takeSelfTime('A', ms(0), ms(26))).toBe(ms(6));
    });

    it('counts a nested child once, through its own parent', () => {
        record('D', 'B', 5, 20);
        record('B', 'A', 2, 22);

        expect(takeSelfTime('A', ms(0), ms(26))).toBe(ms(6));
    });

    it('clamps a child that runs outside the parent window', () => {
        trackChildInterval('A', ms(-10), ms(40));

        expect(takeSelfTime('A', ms(0), ms(26))).toBe(0);
    });

    it('never returns a negative self time', () => {
        trackChildInterval('A', ms(0), ms(10));
        trackChildInterval('A', ms(0), ms(10));

        expect(takeSelfTime('A', ms(0), ms(10))).toBe(0);
        expect(takeSelfTime('B', ms(20), ms(10))).toBe(0);
    });

    it('consumes the children, so a second read returns the full duration', () => {
        trackChildInterval('A', ms(2), ms(20));

        expect(takeSelfTime('A', ms(0), ms(26))).toBe(ms(8));
        expect(takeSelfTime('A', ms(0), ms(26))).toBe(ms(26));
    });

    it('drops the oldest parent once the tracked-parent cap is reached', () => {
        trackChildInterval('oldest', ms(0), ms(10));
        for (let i = 0; i < 256; i++) {
            trackChildInterval(`p${i}`, ms(0), ms(1));
        }

        expect(takeSelfTime('oldest', ms(0), ms(26))).toBe(ms(26)); // evicted, so nothing to subtract
        expect(takeSelfTime('p255', ms(0), ms(26))).toBe(ms(25));
    });

    it('forgets everything on reset', () => {
        trackChildInterval('A', ms(2), ms(20));
        resetComponentSelfTime();

        expect(takeSelfTime('A', ms(0), ms(26))).toBe(ms(26));
    });
});
