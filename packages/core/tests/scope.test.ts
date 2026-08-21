import { describe, expect, it } from 'vitest';

import { RecorderType } from '../src/breadcrumbs';
import { GlobalScopeProvider, Scope } from '../src/Scope';
import type { Glow } from '../src/types';
import { breadcrumbLimits } from './helpers';

const glow = (name: string): Glow => ({
    name,
    messageLevel: 'info',
    metaData: {},
    time: 0,
    microtime: 0,
});

describe('Scope', () => {
    it('starts empty', () => {
        const scope = new Scope();
        expect(scope.glows).toEqual([]);
        expect(scope.breadcrumbs.size).toBe(0);
        expect(scope.pendingAttributes).toEqual({});
        expect(scope.entryPoint).toBeNull();
    });

    it('glows is derived from the breadcrumb buffer', () => {
        const scope = new Scope();
        scope.breadcrumbs.add(
            {
                event: { type: 'php_glow', startTimeUnixNano: 1, endTimeUnixNano: null, attributes: {} },
                recorder: RecorderType.Glow,
                glow: glow('a'),
            },
            breadcrumbLimits(),
        );

        expect(scope.glows.map((g) => g.name)).toEqual(['a']);
    });

    it('sets and merges attributes', () => {
        const scope = new Scope();
        scope.setAttribute('foo', 'bar');
        scope.mergeAttributes({ baz: 1, foo: 'baz' });
        expect(scope.pendingAttributes).toEqual({ foo: 'baz', baz: 1 });
    });

    it('stores entryPoint', () => {
        const scope = new Scope();
        scope.entryPoint = { identifier: '/foo', type: 'browser' };
        expect(scope.entryPoint?.identifier).toBe('/foo');
    });
});

describe('GlobalScopeProvider', () => {
    it('returns the same scope on every active() call', () => {
        const provider = new GlobalScopeProvider();
        const a = provider.active();
        const b = provider.active();
        expect(a).toBe(b);
    });

    it('mutations on the active scope persist', () => {
        const provider = new GlobalScopeProvider();
        provider.active().setAttribute('k', 'v');
        expect(provider.active().pendingAttributes).toEqual({ k: 'v' });
    });
});
