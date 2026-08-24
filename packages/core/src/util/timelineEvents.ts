import type { Glow, SpanEvent } from '../types';
import { glowsToEvents } from './glowsToEvents';

/**
 * Glows and breadcrumbs are two things in the client and one timeline on the report. Someone who
 * debugs an error wants one list, in the order the events happened.
 */
export function timelineEvents(glows: Glow[], breadcrumbs: SpanEvent[]): SpanEvent[] {
    return [...glowsToEvents(glows), ...breadcrumbs].toSorted((a, b) => a.startTimeUnixNano - b.startTimeUnixNano);
}
