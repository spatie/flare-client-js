import { createServer, type Server } from 'node:http';

import { flare } from '@flareapp/node';
import { serve, type ServerType } from '@hono/node-server';
import { test, expect } from '@playwright/test';
import express from 'express';
import { Hono } from 'hono';

import { attr, close, hasMessage, listen, resetReports, setupFlare, waitForReport } from './helpers';

test.beforeAll(() => setupFlare());
test.afterAll(() => flare.removeProcessListeners());
test.beforeEach(() => resetReports());

test('hono: async route error report carries request context', async () => {
    const app = new Hono();
    // CURRENT README shape: report from onError, no try/catch.
    app.use('*', async (c, next) => {
        await flare.runWithContext(
            {
                method: c.req.method,
                path: c.req.path,
                headers: Object.fromEntries(c.req.raw.headers),
            },
            () => next(),
        );
    });
    app.get('/boom', async () => {
        await new Promise((r) => setTimeout(r, 1));
        throw new Error('boom');
    });
    app.onError((err, c) => {
        // flare.report() returns a Promise, but Hono's onError cannot await it.
        // waitForReport() below polls until the fire-and-forget report arrives.
        flare.report(err);
        return c.text('Internal Server Error', 500);
    });

    // serve(..., callback) resolves the bound port from the `listening` event —
    // no `address()` race (address() is null until listening fires).
    let honoServer!: ServerType;
    const base = await new Promise<string>((resolve) => {
        honoServer = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
            resolve(`http://127.0.0.1:${info.port}`);
        });
    });
    try {
        await fetch(`${base}/boom`);
        const report = await waitForReport(hasMessage('boom'));
        expect(attr(report, 'url.path')).toBe('/boom');
        expect(attr(report, 'http.request.method')).toBe('GET');
    } finally {
        await close(honoServer as unknown as Server);
    }
});

test('express5: async route error report carries request context', async () => {
    const app = express();
    // CURRENT README shape: wrap in runWithContext, report from error middleware.
    app.use((req, _res, next) => {
        flare.runWithContext({ method: req.method, path: req.originalUrl, headers: req.headers }, () => next());
    });
    app.get('/boom', async () => {
        await new Promise((r) => setTimeout(r, 1));
        throw new Error('boom');
    });
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        flare.report(err);
        res.status(500).send('Internal Server Error');
    });

    const server = createServer(app);
    const base = await listen(server);
    try {
        await fetch(`${base}/boom`);
        const report = await waitForReport(hasMessage('boom'));
        expect(attr(report, 'url.path')).toBe('/boom');
        expect(attr(report, 'http.request.method')).toBe('GET');
    } finally {
        await close(server);
    }
});
