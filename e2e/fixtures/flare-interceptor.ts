import { type Page, test as base } from '@playwright/test';

type Report = {
    exceptionClass?: string | null;
    message?: string | null;
    seenAtUnixNano: number;
    stacktrace: unknown[];
    events: unknown[];
    attributes: Record<string, unknown>;
    isLog?: boolean;
    level?: string;
    context?: Record<string, unknown>;
    [key: string]: unknown;
};

type WaitForReportOptions = {
    timeout?: number;
    filter?: (report: Report) => boolean;
};

class FlareInterceptor {
    reports: Report[] = [];
    private listeners: Array<(report: Report) => void> = [];

    push(report: Report) {
        this.reports.push(report);
        const pending = this.listeners.slice();
        this.listeners = [];
        for (const cb of pending) cb(report);
    }

    waitForReport(options: WaitForReportOptions = {}): Promise<Report> {
        const { timeout = 5000, filter } = options;

        const match = filter ? this.reports.find(filter) : undefined;
        if (match) return Promise.resolve(match);

        return new Promise<Report>((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.listeners.indexOf(handler);
                if (idx !== -1) this.listeners.splice(idx, 1);
                reject(
                    new Error(`waitForReport timed out after ${timeout}ms (${this.reports.length} reports captured)`)
                );
            }, timeout);

            const handler = (report: Report) => {
                if (filter && !filter(report)) {
                    this.listeners.push(handler);
                    return;
                }
                clearTimeout(timer);
                resolve(report);
            };

            this.listeners.push(handler);
        });
    }

    clear() {
        this.reports = [];
        this.listeners = [];
    }
}

async function setupInterceptor(page: Page): Promise<FlareInterceptor> {
    const interceptor = new FlareInterceptor();

    await page.route('**/ingress.flareapp.io/**', async (route) => {
        const request = route.request();
        const body = request.postDataJSON();
        if (body) interceptor.push(body as Report);
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    });

    page.on('pageerror', () => {});

    return interceptor;
}

export const test = base.extend<{ flare: FlareInterceptor }>({
    flare: async ({ page }, use) => {
        const interceptor = await setupInterceptor(page);
        await use(interceptor);
    },
});

export { expect } from '@playwright/test';
export type { Report };
