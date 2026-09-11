import { describe, expect, test, vi } from 'vitest';

import { settleWithConcurrency } from '../src/settleWithConcurrency';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}

describe('settleWithConcurrency', () => {
    test('never runs more tasks at once than the limit', async () => {
        const items = Array.from({ length: 25 }, (_, i) => i);
        const gates = items.map(() => deferred<void>());
        let running = 0;
        let peak = 0;

        const settled = settleWithConcurrency(items, 10, async (item) => {
            running++;
            peak = Math.max(peak, running);
            await gates[item].promise;
            running--;
        });

        await vi.waitFor(() => expect(running).toBe(10));
        expect(peak).toBe(10);

        for (const gate of gates) {
            gate.resolve();
        }

        await settled;
        expect(peak).toBe(10);
    });

    test('starts a new task as soon as a slot frees up', async () => {
        const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
        const started: number[] = [];

        const settled = settleWithConcurrency([0, 1, 2], 2, async (item) => {
            started.push(item);
            await gates[item].promise;
        });

        await vi.waitFor(() => expect(started).toEqual([0, 1]));

        gates[0].resolve();
        await vi.waitFor(() => expect(started).toEqual([0, 1, 2]));

        gates[1].resolve();
        gates[2].resolve();
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

    test('passes the index to the task', async () => {
        const task = vi.fn().mockResolvedValue(undefined);

        await settleWithConcurrency(['a', 'b'], 2, task);

        expect(task).toHaveBeenNthCalledWith(1, 'a', 0);
        expect(task).toHaveBeenNthCalledWith(2, 'b', 1);
    });

    test('returns an empty list for an empty input', async () => {
        const task = vi.fn().mockResolvedValue(undefined);

        await expect(settleWithConcurrency([], 10, task)).resolves.toEqual([]);
        expect(task).not.toHaveBeenCalled();
    });

    test('runs one task at a time when the limit is below one', async () => {
        let running = 0;
        let peak = 0;

        await settleWithConcurrency([0, 1, 2], 0, async () => {
            running++;
            peak = Math.max(peak, running);
            await Promise.resolve();
            running--;
        });

        expect(peak).toBe(1);
    });
});
