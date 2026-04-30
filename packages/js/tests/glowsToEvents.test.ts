import { expect, test } from 'vitest';

import { Glow } from '../src/types';
import { glowsToEvents } from '../src/util/glowsToEvents';

test('maps glow to php_glow span event with nanosecond startTime', () => {
    const glow: Glow = {
        time: 1700000000,
        microtime: 1700000000.5,
        name: 'rendering',
        message_level: 'info',
        meta_data: { step: 1 },
    };

    expect(glowsToEvents([glow])).toEqual([
        {
            type: 'php_glow',
            startTimeUnixNano: 1700000000_500_000_000,
            endTimeUnixNano: null,
            attributes: {
                'glow.name': 'rendering',
                'glow.level': 'info',
                'glow.context': { step: 1 },
            },
        },
    ]);
});

test('falls back to empty object when meta_data is missing', () => {
    const glow: Glow = {
        time: 0,
        microtime: 0,
        name: 'noop',
        message_level: 'debug',
        meta_data: undefined as any,
    };

    expect(glowsToEvents([glow])[0].attributes['glow.context']).toEqual({});
});
