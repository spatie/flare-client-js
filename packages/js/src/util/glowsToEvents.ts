import { V2AttributeValue, V2SpanEvent } from '../api/v2WireTypes';
import { Glow } from '../types';

// glow.microtime is seconds since epoch with sub-second fraction (see util/now.ts).
// V2SpanEvent.startTimeUnixNano is unix nanoseconds.
export function glowsToEvents(glows: Glow[]): V2SpanEvent[] {
    return glows.map((glow) => ({
        type: 'php_glow',
        startTimeUnixNano: Math.round(glow.microtime * 1_000_000_000),
        endTimeUnixNano: null,
        attributes: {
            'glow.name': String(glow.name),
            'glow.level': glow.message_level,
            'glow.context': (glow.meta_data ?? {}) as V2AttributeValue,
        },
    }));
}
