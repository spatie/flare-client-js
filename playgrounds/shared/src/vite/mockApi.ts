import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

import {
    apiDelaysMs,
    createOrder,
    delay,
    getCartSummary,
    getProduct,
    getRecommendations,
    listProducts,
} from '../api/server';
import type { CartLineInput } from '../api/types';

type Handled = { status: number; body: unknown; delayMs: number };

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }

    if (!chunks.length) return {};

    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};

const route = async (req: IncomingMessage, url: URL): Promise<Handled | null> => {
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (method === 'GET' && path === '/api/products') {
        return { status: 200, body: listProducts(), delayMs: apiDelaysMs.products };
    }

    if (method === 'GET' && path.startsWith('/api/products/')) {
        const detail = getProduct(path.slice('/api/products/'.length));
        return detail
            ? { status: 200, body: detail, delayMs: apiDelaysMs.product }
            : { status: 404, body: { message: 'Product not found' }, delayMs: apiDelaysMs.product };
    }

    if (method === 'GET' && path === '/api/recommendations') {
        const exclude = url.searchParams.get('exclude') ?? undefined;
        return { status: 200, body: getRecommendations(exclude), delayMs: apiDelaysMs.recommendations };
    }

    if (method === 'POST' && path === '/api/cart/summary') {
        const body = await readBody(req);
        const lines = Array.isArray(body.lines) ? (body.lines as CartLineInput[]) : [];
        return { status: 200, body: getCartSummary(lines), delayMs: apiDelaysMs.cartSummary };
    }

    if (method === 'POST' && path === '/api/checkout') {
        const body = await readBody(req);
        const totalCents = typeof body.totalCents === 'number' ? body.totalCents : 0;
        return { status: 200, body: createOrder(totalCents), delayMs: apiDelaysMs.checkout };
    }

    return null;
};

// Serves the playground catalog API in `vite dev` and `vite preview`. The routes exist so a page load
// produces a trace waterfall with real, differently sized request spans under it. The SvelteKit
// playground reaches the same handlers through its own `+server.ts` routes instead, because Kit owns
// request handling there.
export function mockApi(): Plugin {
    const middleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void => {
        if (!req.url?.startsWith('/api/')) {
            next();
            return;
        }

        const url = new URL(req.url, 'http://localhost');

        void route(req, url)
            .then(async (handled) => {
                if (!handled) {
                    next();
                    return;
                }

                await delay(handled.delayMs);

                res.statusCode = handled.status;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(handled.body));
            })
            .catch(next);
    };

    return {
        name: 'flare-playground-mock-api',
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}
