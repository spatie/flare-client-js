import type { Glow, SpanEvent } from '../types';
import { glowsToEvents } from './glowsToEvents';

function byTime(a: SpanEvent, b: SpanEvent): number {
    return a.startTimeUnixNano - b.startTimeUnixNano;
}

// We merge the breadcrumbs and glows to show them
// together in the ignition timeline in Flare
export function timelineEvents(glows: Glow[], breadcrumbs: SpanEvent[]): SpanEvent[] {
    const events: SpanEvent[] = [...glowsToEvents(glows), ...breadcrumbs];
    return events.sort(byTime);
}
