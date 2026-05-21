import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { FakeFlareEndpoint, FakeFlareRecord, FakeFlareServer, WaitForOptions } from './types';

const REPORTS_PATH = '/api/reports';
const SOURCEMAPS_PATH = '/api/sourcemaps';
const INSPECT_REPORTS = '/__inspect/reports';
const INSPECT_RESET = '/__inspect/reset';

type Listener = (record: FakeFlareRecord) => void;

const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });

const headersToRecord = (req: IncomingMessage): Record<string, string> => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[key] = value;
        else if (Array.isArray(value)) headers[key] = value.join(', ');
    }
    return headers;
};

const tryParseJson = (text: string): unknown | null => {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
};

const writeJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('access-control-allow-origin', '*');
    res.end(JSON.stringify(body));
};

const writeEmpty = (res: ServerResponse, status: number): void => {
    res.statusCode = status;
    res.setHeader('access-control-allow-origin', '*');
    res.end();
};

const handleCors = (res: ServerResponse): void => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', '*');
    res.statusCode = 204;
    res.end();
};

export const startFakeFlareServer = async (options: { port?: number } = {}): Promise<FakeFlareServer> => {
    const records: FakeFlareRecord[] = [];
    const listeners = new Set<Listener>();

    const notify = (record: FakeFlareRecord): void => {
        for (const listener of Array.from(listeners)) listener(record);
    };

    const record = async (req: IncomingMessage, endpoint: FakeFlareEndpoint): Promise<FakeFlareRecord> => {
        const bodyText = await readBody(req);
        const entry: FakeFlareRecord = {
            endpoint,
            method: req.method ?? 'POST',
            path: req.url ?? '',
            headers: headersToRecord(req),
            bodyText,
            bodyJson: tryParseJson(bodyText),
            receivedAt: Date.now(),
        };
        records.push(entry);
        notify(entry);
        return entry;
    };

    const server = createServer(async (req, res) => {
        try {
            if (req.method === 'OPTIONS') {
                handleCors(res);
                return;
            }

            const url = req.url ?? '';

            if (req.method === 'POST' && url.startsWith(REPORTS_PATH)) {
                await record(req, 'reports');
                writeJson(res, 201, {});
                return;
            }

            if (req.method === 'POST' && url.startsWith(SOURCEMAPS_PATH)) {
                await record(req, 'sourcemaps');
                writeJson(res, 200, {});
                return;
            }

            if (req.method === 'GET' && url === INSPECT_REPORTS) {
                writeJson(res, 200, records);
                return;
            }

            if (req.method === 'POST' && url === INSPECT_RESET) {
                records.length = 0;
                writeEmpty(res, 204);
                return;
            }

            writeJson(res, 404, { error: 'not found', url });
        } catch (error) {
            writeJson(res, 500, { error: (error as Error).message });
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    const port = address.port;
    const url = `http://127.0.0.1:${port}`;

    const reset = (): void => {
        records.length = 0;
    };

    const waitForReport = (opts: WaitForOptions = {}): Promise<FakeFlareRecord> => {
        const { timeout = 5000, predicate } = opts;

        const existing = records.find((r) => r.endpoint === 'reports' && (!predicate || predicate(r)));
        if (existing) return Promise.resolve(existing);

        return new Promise<FakeFlareRecord>((resolve, reject) => {
            const timer = setTimeout(() => {
                listeners.delete(listener);
                reject(new Error(`waitForReport timed out after ${timeout}ms (${records.length} records captured)`));
            }, timeout);

            const listener: Listener = (entry) => {
                if (entry.endpoint !== 'reports') return;
                if (predicate && !predicate(entry)) return;
                clearTimeout(timer);
                listeners.delete(listener);
                resolve(entry);
            };
            listeners.add(listener);
        });
    };

    const stop = (): Promise<void> =>
        new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });

    return {
        url,
        port,
        records: () => [...records],
        reports: () => records.filter((r) => r.endpoint === 'reports'),
        sourcemaps: () => records.filter((r) => r.endpoint === 'sourcemaps'),
        reset,
        waitForReport,
        stop,
    };
};
