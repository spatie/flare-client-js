import { describe, expect, it } from 'vitest';

import { AsyncLocalStorageScopeProvider } from '../src/scope/AsyncLocalStorageScopeProvider';
import { NodeScope } from '../src/scope/NodeScope';

describe('AsyncLocalStorageScopeProvider', () => {
    it('falls back to a shared NodeScope outside runWithContext', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const a = provider.active();
        const b = provider.active();
        expect(a).toBeInstanceOf(NodeScope);
        expect(a).toBe(b);
    });

    it('returns null from getContext outside runWithContext', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        expect(provider.getContext()).toBeNull();
    });

    it('isolates scopes across runWithContext calls', async () => {
        const provider = new AsyncLocalStorageScopeProvider();
        const results: Array<string | undefined> = [];

        async function workload(label: string) {
            return provider.runWithContext({ path: `/${label}` }, async () => {
                await new Promise((r) => setTimeout(r, Math.random() * 20));
                results.push(provider.active().request.path);
            });
        }

        await Promise.all([workload('a'), workload('b'), workload('c')]);
        results.sort();
        expect(results).toEqual(['/a', '/b', '/c']);
    });

    it('mergeContext patches the active scope', () => {
        const provider = new AsyncLocalStorageScopeProvider();
        provider.runWithContext({ method: 'GET' }, () => {
            provider.mergeContext({ path: '/foo' });
            expect(provider.active().request).toEqual({ method: 'GET', path: '/foo' });
        });
    });
});
