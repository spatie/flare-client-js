import { describe, expect, test, vi } from 'vitest';

import { settleWithConcurrency } from '../src/settleWithConcurrency';
import { createConcurrencyProbe } from './helpers/concurrencyProbe';

describe('settleWithConcurrency', () => {
    test('never runs more tasks at once than the limit', async () => {
        const probe = createConcurrencyProbe();
        const items = Array.from({ length: 25 }, (_, i) => i);

        const settled = settleWithConcurrency(items, 10, probe.start);

        await vi.waitFor(() => expect(probe.running).toBe(10));
        await probe.drain();
        await settled;

        expect(probe.peak).toBe(10);
    });

    test('starts a new task as soon as a slot frees up', async () => {
        const probe = createConcurrencyProbe();
        const started: number[] = [];

        const settled = settleWithConcurrency([0, 1, 2], 2, (item) => {
            started.push(item);
            return probe.start();
        });

        await vi.waitFor(() => expect(started).toEqual([0, 1]));

        probe.releaseOne();
        await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));

        await probe.drain();
        await settled;
    });

    test('returns results in input order', async () => {
        const results = await settleWithConcurrency([3, 1, 2], 2, async (item) => {
            await new Promise((resolve) => setTimeout(resolve, item));
            return item * 10;
        });

        expect(results).toEqual([
            { status: 'fulfilled', value: 30 },
            { status: 'fulfilled', value: 10 },
            { status: 'fulfilled', value: 20 },
        ]);
    });

    test('records a rejection without stopping the other tasks', async () => {
        const results = await settleWithConcurrency([0, 1, 2], 2, async (item) => {
            if (item === 1) {
                throw new Error('boom');
            }
            return item;
        });

        expect(results[0]).toEqual({ status: 'fulfilled', value: 0 });
        expect(results[1]).toEqual({ status: 'rejected', reason: new Error('boom') });
        expect(results[2]).toEqual({ status: 'fulfilled', value: 2 });
    });

    test('returns an empty list for an empty input', async () => {
        const task = vi.fn().mockResolvedValue(undefined);

        await expect(settleWithConcurrency([], 10, task)).resolves.toEqual([]);
        expect(task).not.toHaveBeenCalled();
    });
});
