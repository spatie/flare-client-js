import { describe, expect, test } from 'vitest';

import { glowsToEvents } from '../src/util/glowsToEvents';

describe('glowsToEvents', () => {
    test('produces a php_glow span event per glow', () => {
        const events = glowsToEvents([
            { name: 'rendering checkout', messageLevel: 'info', metaData: { cartId: 7 }, time: 1, microtime: 1 },
        ]);

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
            type: 'php_glow',
            startTimeUnixNano: 1_000_000_000,
            endTimeUnixNano: null,
            attributes: {
                'glow.name': 'rendering checkout',
                'glow.level': 'info',
                'glow.context': { cartId: 7 },
            },
        });
    });

    test('defaults missing metaData to empty object', () => {
        const events = glowsToEvents([
            {
                name: 'x',
                messageLevel: 'warning',
                metaData: undefined as unknown as Record<string, unknown>,
                time: 2,
                microtime: 2,
            },
        ]);

        expect(events[0].attributes['glow.context']).toEqual({});
    });

    test('returns empty array for empty input', () => {
        expect(glowsToEvents([])).toEqual([]);
    });
});
