import { AttributeValue, Glow, SpanEvent } from '../types';

// glow.microtime is seconds since epoch with a fractional part (see Flare.glow).
// SpanEvent.startTimeUnixNano is unix nanoseconds.
export function glowToEvent(glow: Glow): SpanEvent {
    return {
        type: 'php_glow',
        startTimeUnixNano: Math.round(glow.microtime * 1_000_000_000),
        endTimeUnixNano: null,
        attributes: {
            'glow.name': String(glow.name),
            'glow.level': glow.messageLevel,
            'glow.context': (glow.metaData ?? {}) as AttributeValue,
        },
    };
}

export function glowsToEvents(glows: readonly Glow[]): SpanEvent[] {
    return glows.map(glowToEvent);
}
