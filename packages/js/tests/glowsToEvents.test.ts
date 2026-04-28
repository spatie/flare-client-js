import { describe, expect, test } from 'vitest';

import { glowsToEvents } from '../src/util/glowsToEvents';

describe('glowsToEvents', () => {
    test('produces a js_glow span event per glow', () => {
        const events = glowsToEvents([
            { name: 'rendering checkout', message_level: 'info', meta_data: { cartId: 7 }, time: 1, microtime: 1 },
        ]);

        expect(events).toHaveLength(1);
        expect(events[0]).toEqual({
            type: 'js_glow',
            startTimeUnixNano: 1_000_000_000,
            endTimeUnixNano: null,
            attributes: {
                'glow.name': 'rendering checkout',
                'glow.level': 'info',
                'glow.context': { cartId: 7 },
            },
        });
    });

    test('defaults missing meta_data to empty object', () => {
        const events = glowsToEvents([
            { name: 'x', message_level: 'warning', meta_data: undefined as unknown as object, time: 2, microtime: 2 },
        ]);

        expect(events[0].attributes['glow.context']).toEqual({});
    });

    test('returns empty array for empty input', () => {
        expect(glowsToEvents([])).toEqual([]);
    });
});
