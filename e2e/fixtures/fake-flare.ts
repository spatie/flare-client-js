import { test as base } from '@playwright/test';

import type { FakeFlareRecord } from '../fake-flare-server/types';

const baseUrl = (): string => {
    const url = process.env.FAKE_FLARE_URL;
    if (!url) throw new Error('FAKE_FLARE_URL not set. globalSetup must run before fixtures.');
    return url;
};

const fetchReports = async (): Promise<FakeFlareRecord[]> => {
    const response = await fetch(`${baseUrl()}/__inspect/reports`);
    if (!response.ok) throw new Error(`inspect reports returned ${response.status}`);
    return (await response.json()) as FakeFlareRecord[];
};

const reset = async (): Promise<void> => {
    const response = await fetch(`${baseUrl()}/__inspect/reset`, { method: 'POST' });
    if (!response.ok) throw new Error(`inspect reset returned ${response.status}`);
};

type WaitOptions = {
    timeout?: number;
    predicate?: (record: FakeFlareRecord) => boolean;
};

const waitForReport = async (options: WaitOptions = {}): Promise<FakeFlareRecord> => {
    const { timeout = 5000, predicate } = options;
    const deadline = Date.now() + timeout;
    let lastCount = 0;
    while (Date.now() < deadline) {
        const records = await fetchReports();
        const reports = records.filter((r) => r.endpoint === 'reports');
        const match = predicate ? reports.find(predicate) : reports[0];
        if (match) return match;
        lastCount = reports.length;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`waitForReport timed out after ${timeout}ms (${lastCount} reports captured)`);
};

const assertNoReports = async (within = 500): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, within));
    const records = await fetchReports();
    const reports = records.filter((r) => r.endpoint === 'reports');
    if (reports.length > 0) {
        throw new Error(`Expected 0 reports, got ${reports.length}: ${JSON.stringify(reports.map((r) => r.bodyJson))}`);
    }
};

const waitForLog = async (options: WaitOptions = {}): Promise<FakeFlareRecord> => {
    const { timeout = 5000, predicate } = options;
    const deadline = Date.now() + timeout;
    let lastCount = 0;
    while (Date.now() < deadline) {
        const records = await fetchReports();
        const logs = records.filter((r) => r.endpoint === 'logs');
        const match = predicate ? logs.find(predicate) : logs[0];
        if (match) return match;
        lastCount = logs.length;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`waitForLog timed out after ${timeout}ms (${lastCount} logs captured)`);
};

export type FakeFlare = {
    reset: typeof reset;
    reports: () => Promise<FakeFlareRecord[]>;
    logs: () => Promise<FakeFlareRecord[]>;
    waitForReport: typeof waitForReport;
    waitForLog: typeof waitForLog;
    assertNoReports: typeof assertNoReports;
};

export const test = base.extend<{ fakeFlare: FakeFlare }>({
    fakeFlare: async ({ page: _page }, use) => {
        await reset();
        await use({
            reset,
            reports: async () => (await fetchReports()).filter((r) => r.endpoint === 'reports'),
            logs: async () => (await fetchReports()).filter((r) => r.endpoint === 'logs'),
            waitForReport,
            waitForLog,
            assertNoReports,
        });
    },
});

export { expect } from '@playwright/test';
export type { FakeFlareRecord };
