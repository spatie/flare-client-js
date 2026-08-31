import type { Glow, SpanEvent } from '../types';
import { glowsToEvents } from './glowsToEvents';

function byTime(a: SpanEvent, b: SpanEvent): number {
    return a.startTimeUnixNano - b.startTimeUnixNano;
}

// Feeds the ignition timeline in the Flare UI.
export function timelineEvents(glows: Glow[], breadcrumbs: SpanEvent[]): SpanEvent[] {
    const events: SpanEvent[] = [...glowsToEvents(glows), ...breadcrumbs];
    return events.sort(byTime);
}
