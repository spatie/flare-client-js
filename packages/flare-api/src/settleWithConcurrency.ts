export async function settleWithConcurrency<TItem, TResult>(
    items: readonly TItem[],
    concurrency: number,
    task: (item: TItem) => Promise<TResult>,
): Promise<PromiseSettledResult<TResult>[]> {
    const results: PromiseSettledResult<TResult>[] = Array.from({ length: items.length });
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const index = nextIndex++;

            try {
                results[index] = { status: 'fulfilled', value: await task(items[index]) };
            } catch (reason) {
                results[index] = { status: 'rejected', reason };
            }
        }
    }

    const workerCount = Math.min(concurrency, items.length);

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results;
}
