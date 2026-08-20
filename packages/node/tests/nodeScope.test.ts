import { RecorderType } from '@flareapp/core';
import { describe, expect, it } from 'vitest';

import { NodeScope } from '../src/scope/NodeScope';

describe('NodeScope', () => {
    it('starts with empty request', () => {
        const scope = new NodeScope();
        expect(scope.request).toEqual({});
    });

    it('inherits core Scope behavior (glows, attributes, entryPoint)', () => {
        const scope = new NodeScope();
        scope.setAttribute('k', 'v');
        scope.breadcrumbs.add(
            {
                event: { type: 'php_glow', startTimeUnixNano: 0, endTimeUnixNano: null, attributes: {} },
                recorder: RecorderType.Glow,
                glow: { name: 'g', messageLevel: 'info', metaData: {}, time: 0, microtime: 0 },
            },
            { maxBreadcrumbs: 100, maxBreadcrumbBytes: 64_000, maxBreadcrumbEntryBytes: 8_000, maxGlowsPerReport: 30 },
        );

        expect(scope.pendingAttributes).toEqual({ k: 'v' });
        expect(scope.glows.length).toBe(1);
    });
});
