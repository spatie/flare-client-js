import { describe, expect, it } from 'vitest';

import { NodeScope } from '../src/scope/NodeScope';

describe('NodeScope', () => {
    it('starts with empty request and null user', () => {
        const scope = new NodeScope();
        expect(scope.request).toEqual({});
        expect(scope.user).toBeNull();
    });

    it('inherits core Scope behavior (glows, attributes, entryPoint)', () => {
        const scope = new NodeScope();
        scope.setAttribute('k', 'v');
        scope.addGlow({ name: 'g', messageLevel: 'info', metaData: {}, time: 0, microtime: 0 }, 10);
        expect(scope.pendingAttributes).toEqual({ k: 'v' });
        expect(scope.glows.length).toBe(1);
    });
});
