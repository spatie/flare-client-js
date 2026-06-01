import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { flare } from '@flareapp/node';

import type { FakeFlareRecord } from '../fake-flare-server/types';

const fakeBaseUrl = (): string => {
    const url = process.env.FAKE_FLARE_URL;
    if (!url) throw new Error('FAKE_FLARE_URL not set. globalSetup must run before these tests.');
    return url;
};

/** Clear all captured reports on the fake server. */
export const resetReports = async (): Promise<void> => {
    const res = await fetch(`${fakeBaseUrl()}/__inspect/reset`, { method: 'POST' });
    if (!res.ok) throw new Error(`inspect reset returned ${res.status}`);
};

/** Poll the fake server until a recorded report matches `predicate`, or time out. */
export const waitForReport = async (
    predicate: (record: FakeFlareRecord) => boolean,
    timeout = 5000,
): Promise<FakeFlareRecord> => {
    const deadline = Date.now() + timeout;
    let lastCount = 0;
    while (Date.now() < deadline) {
        const res = await fetch(`${fakeBaseUrl()}/__inspect/reports`);
        if (!res.ok) throw new Error(`inspect reports returned ${res.status}`);
        const records = (await res.json()) as FakeFlareRecord[];
        const reports = records.filter((r) => r.endpoint === 'reports');
        const match = reports.find(predicate);
        if (match) return match;
        lastCount = reports.length;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`waitForReport timed out after ${timeout}ms (${lastCount} reports captured)`);
};

/** Bind an http.Server to an ephemeral port and return its base URL. */
export const listen = (server: Server): Promise<string> =>
    new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as AddressInfo;
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });

/**
 * Close a server and wait for it to fully release its handle. Matches the
 * repo's existing pattern (`packages/node/tests/integration.test.ts`):
 * `await new Promise((r) => server.close(() => r()))`.
 */
export const close = (server: Server): Promise<void> =>
    new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
    });

/**
 * Point the shared `flare` singleton at the fake server and disable process
 * handlers so a framework-caught error never exits the test process.
 */
export const setupFlare = (): void => {
    flare.configure({ ingestUrl: `${fakeBaseUrl()}/api/reports` });
    flare.configureNode({ uncaughtExceptionMode: 'off', unhandledRejectionMode: 'off' });
    // Synthetic key on purpose: reports go to the fake server, not real Flare. Do not wire an env key here.
    flare.light('node-frameworks-test');
};

/** Helper to read an attribute off a captured report. */
export const attr = (record: FakeFlareRecord, key: string): unknown => {
    const body = record.bodyJson as { attributes?: Record<string, unknown> } | null;
    return body?.attributes?.[key];
};

/** Predicate: report message equals `msg`. */
export const hasMessage =
    (msg: string) =>
    (record: FakeFlareRecord): boolean => {
        const body = record.bodyJson as { message?: string } | null;
        return body?.message === msg;
    };
