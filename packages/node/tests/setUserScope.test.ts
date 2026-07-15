import { FakeApi } from '@flareapp/test-helpers';
import { describe, expect, it } from 'vitest';

import { NodeFlare } from '../src/Flare';

function makeInstance() {
    const api = new FakeApi();
    const instance = new NodeFlare();
    instance.api = api;
    instance.light('test-key');
    instance.removeProcessListeners();
    return { instance, api };
}

describe('setUser on NodeFlare', () => {
    it('writes user.* and client.address (not enduser.*) on the report', async () => {
        const { instance, api } = makeInstance();

        await instance.runWithContext({ method: 'GET', path: '/test' }, async () => {
            instance.setUser({ id: 7, email: 'u@x.io', fullName: 'U X', ipAddress: '1.2.3.4' });
            await instance.report(new Error('boom'));
        });

        expect(api.reports.length).toBe(1);
        const attrs = api.reports[0].attributes as Record<string, unknown>;
        expect(attrs['user.id']).toBe('7');
        expect(attrs['user.email']).toBe('u@x.io');
        expect(attrs['user.full_name']).toBe('U X');
        expect(attrs['client.address']).toBe('1.2.3.4');
        expect(attrs['enduser.id']).toBeUndefined();
    });

    it('isolates user identity per request scope', async () => {
        const { instance, api } = makeInstance();

        await Promise.all([
            instance.runWithContext({ path: '/a' }, async () => {
                instance.setUser({ id: 'user-a' });
                await new Promise((r) => setTimeout(r, 10));
                await instance.report(new Error('a'));
            }),
            instance.runWithContext({ path: '/b' }, async () => {
                instance.setUser({ id: 'user-b' });
                await instance.report(new Error('b'));
            }),
        ]);

        const ids = api.reports.map((r) => (r.attributes as Record<string, unknown>)['user.id']).toSorted();
        expect(ids).toEqual(['user-a', 'user-b']);
    });
});
