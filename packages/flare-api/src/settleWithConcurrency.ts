export async function settleWithConcurrency<TItem, TResult>(
    items: readonly TItem[],
    limit: number,
    task: (item: TItem, index: number) => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
    const results: PromiseSettledResult<TResult>[] = Array.from({ length: items.length });
    let next = 0;

    async function worker(): Promise<void> {
        while (next < items.length) {
            const index = next++;

            try {
                results[index] = { status: 'fulfilled', value: await task(items[index], index) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }

    const workerCount = Math.max(1, Math.min(Math.floor(limit), items.length));

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
}
