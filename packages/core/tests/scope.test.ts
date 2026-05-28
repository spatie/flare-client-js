import { describe, expect, it } from 'vitest';

import { Scope } from '../src/Scope';
import type { Glow } from '../src/types';

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
        expect(scope.pendingAttributes).toEqual({});
        expect(scope.entryPoint).toBeNull();
    });

    it('adds glows and caps at max', () => {
        const scope = new Scope();
        scope.addGlow(glow('a'), 2);
        scope.addGlow(glow('b'), 2);
        scope.addGlow(glow('c'), 2);
        expect(scope.glows.map((g) => g.name)).toEqual(['b', 'c']);
    });

    it('clears glows', () => {
        const scope = new Scope();
        scope.addGlow(glow('a'), 10);
        scope.clearGlows();
        expect(scope.glows).toEqual([]);
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
