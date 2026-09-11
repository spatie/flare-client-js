// Holds every started task until released and records how many ran at once.
export function createConcurrencyProbe() {
    const pending: Array<() => void> = [];
    let running = 0;
    let peak = 0;

    function start(): Promise<void> {
        running++;
        peak = Math.max(peak, running);

        return new Promise((resolve) => {
            pending.push(() => {
                running--;
                resolve();
            });
        });
    }

    function releaseOne(): void {
        pending.shift()?.();
    }

    async function drain(): Promise<void> {
        while (pending.length > 0) {
            releaseOne();
            // A macrotask boundary lets the pool start its next task before the next release.
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return {
        start,
        releaseOne,
        drain,
        get running() {
            return running;
        },
        get peak() {
            return peak;
        },
    };
}
