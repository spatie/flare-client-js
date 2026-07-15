import { FakeApi } from '@flareapp/test-helpers';
import { describe, expect, it } from 'vitest';

import { NodeFlare } from '../src/Flare';

function makeInstance() {
    const api = new FakeApi();
    const instance = new NodeFlare();
    instance.api = api;
    instance.light('test-key');
    return { instance, api };
}

describe('setFramework inside runWithContext', () => {
    it('framework attrs appear in report even when called inside a request scope', async () => {
        const { instance, api } = makeInstance();

        instance.setFramework({ name: 'Express', version: '4.0.0' });

        await instance.runWithContext({ method: 'GET', path: '/test' }, async () => {
            await instance.report(new Error('boom'));
        });

        expect(api.reports.length).toBe(1);
        const attrs = api.reports[0].attributes as Record<string, unknown>;
        expect(attrs['flare.framework.name']).toBe('Express');
        expect(attrs['flare.framework.version']).toBe('4.0.0');
    });

    it('framework attrs appear when setFramework is called before runWithContext', async () => {
        const { instance, api } = makeInstance();

        instance.setFramework({ name: 'Fastify', version: '5.0.0' });

        await instance.runWithContext({ method: 'POST', path: '/submit' }, async () => {
            await instance.report(new Error('fastify-error'));
        });

        expect(api.reports.length).toBe(1);
        const attrs = api.reports[0].attributes as Record<string, unknown>;
        expect(attrs['flare.framework.name']).toBe('Fastify');
        expect(attrs['flare.framework.version']).toBe('5.0.0');
    });

    it('framework attrs appear in report outside of runWithContext', async () => {
        const { instance, api } = makeInstance();

        instance.setFramework({ name: 'Koa', version: '3.0.0' });
        await instance.report(new Error('koa-error'));

        expect(api.reports.length).toBe(1);
        const attrs = api.reports[0].attributes as Record<string, unknown>;
        expect(attrs['flare.framework.name']).toBe('Koa');
        expect(attrs['flare.framework.version']).toBe('3.0.0');
    });

    it('context.custom.framework is set inside runWithContext when setFramework was called at startup', async () => {
        const { instance, api } = makeInstance();

        instance.setFramework({ name: 'Express', version: '4.0.0' });

        await instance.runWithContext({ method: 'GET', path: '/test' }, async () => {
            await instance.report(new Error('boom'));
        });

        expect(api.reports.length).toBe(1);
        const custom = api.reports[0].attributes['context.custom'] as Record<string, unknown>;
        expect(custom.framework).toBe('express');
    });

    it('context.custom.framework is set outside runWithContext', async () => {
        const { instance, api } = makeInstance();

        instance.setFramework({ name: 'Koa', version: '3.0.0' });
        await instance.report(new Error('koa-error'));

        expect(api.reports.length).toBe(1);
        const custom = api.reports[0].attributes['context.custom'] as Record<string, unknown>;
        expect(custom.framework).toBe('koa');
    });
});
