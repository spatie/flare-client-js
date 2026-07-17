import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getRouteContext } from '../../src/client/getRouteContext';

vi.mock('@flareapp/js', () => ({
    DEFAULT_URL_DENYLIST:
        /password|passwd|pwd|token|secret|authorization|\bauth\b|bearer|oauth|credentials?|cookie|api[-_]?key|private[-_]?key|session|csrf|xsrf|\bpin\b|\bssn\b|card[-_]?number|\bcvv\b/i,
}));

const mockPage = await vi.hoisted(async () => {
    const mod = await import('../../tests/__mocks__/app-state.svelte');
    return mod.page;
});

vi.mock('$app/state', () => ({
    page: mockPage,
}));

beforeEach(() => {
    mockPage.url = new URL('http://localhost/');
    mockPage.params = {};
    mockPage.route = { id: null };
});

describe('getRouteContext', () => {
    test('extracts route context from page state', () => {
        mockPage.url = new URL('http://localhost/users/42?sort=name');
        mockPage.params = { id: '42' };
        mockPage.route = { id: '/users/[id]' };

        const context = getRouteContext();

        expect(context).toEqual({
            routeId: '/users/[id]',
            url: '/users/42',
            params: { id: '42' },
            query: { sort: 'name' },
        });
    });

    test('redacts sensitive query params', () => {
        mockPage.url = new URL('http://localhost/login?username=alice&password=secret&token=abc');

        const context = getRouteContext();

        expect(context.query).toEqual({
            username: 'alice',
            password: '[redacted]',
            token: '[redacted]',
        });
    });

    test('redacts sensitive route params by key', () => {
        mockPage.url = new URL('http://localhost/reset-password/tok');
        mockPage.params = { token: 'tok', id: '42' };

        const context = getRouteContext();

        expect(context.params).toEqual({ token: '[redacted]', id: '42' });
    });

    test('handles null route id', () => {
        mockPage.route = { id: null };

        const context = getRouteContext();

        expect(context.routeId).toBeNull();
    });

    test('handles routes with no query params', () => {
        mockPage.url = new URL('http://localhost/about');

        const context = getRouteContext();

        expect(context.query).toEqual({});
    });
});
