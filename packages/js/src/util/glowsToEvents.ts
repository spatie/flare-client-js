import { AttributeValue, Glow, SpanEvent } from '../types';

// glow.microtime is seconds since epoch (see util/now.ts).
// SpanEvent.startTimeUnixNano is unix nanoseconds.
export function glowsToEvents(glows: Glow[]): SpanEvent[] {
    return glows.map((glow) => ({
        type: 'js_glow',
        startTimeUnixNano: Math.round(glow.microtime * 1_000_000_000),
        endTimeUnixNano: null,
        attributes: {
            'glow.name': String(glow.name),
            'glow.level': glow.message_level,
            'glow.context': (glow.meta_data ?? {}) as AttributeValue,
        },
    }));
}
