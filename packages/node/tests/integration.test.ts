import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startFakeFlareServer } from '../../../e2e/fake-flare-server';
import type { FakeFlareServer } from '../../../e2e/fake-flare-server';

let fakeFlareServer: FakeFlareServer;

beforeAll(async () => {
    fakeFlareServer = await startFakeFlareServer();
});

afterAll(async () => {
    await fakeFlareServer?.stop();
});

describe('Node SDK integration', () => {
    it('reports an error through a real HTTP server', async () => {
        const { flare } = await import('../src');
        flare.removeProcessListeners();
        flare.configureNode({ uncaughtExceptionMode: 'off', unhandledRejectionMode: 'off' });
        flare.configure({ ingestUrl: `${fakeFlareServer.url}/v1/errors` });
        flare.light('test-key');

        fakeFlareServer.reset();

        let captured = false;
        const app: Server = createServer((req, res) => {
            flare.runWithContext({ method: req.method!, path: req.url! }, async () => {
                if (req.url === '/boom') {
                    try {
                        throw new Error('integration-boom');
                    } catch (e) {
                        await flare.report(e as Error);
                        captured = true;
                    }
                }
                res.end('ok');
            });
        });

        await new Promise<void>((r) => app.listen(0, r));
        const port = (app.address() as { port: number }).port;

        await fetch(`http://localhost:${port}/boom`);
        await flare.flush(1500);

        expect(captured).toBe(true);

        const reports = fakeFlareServer.reports();
        expect(reports.length).toBe(1);

        const body = reports[0].bodyJson as Record<string, unknown>;
        expect(body.message).toBe('integration-boom');

        const attributes = body.attributes as Record<string, unknown>;
        expect(attributes['http.request.method']).toBe('GET');
        expect(attributes['url.path']).toBe('/boom');

        await new Promise<void>((r) => app.close(() => r()));
    });
});
