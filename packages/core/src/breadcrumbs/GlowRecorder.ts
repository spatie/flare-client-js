import type { Glow, MessageLevel } from '../types';
import { glowToEvent } from '../util/glowsToEvents';
import { now } from '../util/now';
import { SpanEventsRecorder } from './SpanEventsRecorder';
import { RecorderType } from './types';

/**
 * The manual recorder: the one a developer calls directly through `flare.glow()`. PHP treats glows the same
 * way, as one recorder among the automatic ones rather than a special case beside them.
 */
export class GlowRecorder extends SpanEventsRecorder {
    readonly recorderType = RecorderType.Glow;

    record(name: string, level: MessageLevel, data: Record<string, unknown> | Record<string, unknown>[]): void {
        // `time` is a whole-second unix timestamp, `microtime` the same instant with milliseconds, matching
        // PHP's Glow. The event's nanosecond timestamp is derived from microtime, so a page that glows twice
        // in one second still sorts right on the timeline. now() rounds, so past the half-second the two differ.
        const glow: Glow = {
            name,
            messageLevel: level,
            metaData: data,
            time: now(),
            microtime: Date.now() / 1000,
        };

        const event = glowToEvent(glow);

        this.spanEvent({
            type: event.type,
            attributes: event.attributes,
            startTimeUnixNano: event.startTimeUnixNano,
            entry: { glow },
        });
    }

    clear(): void {
        this.deps.buffer().clearRecorder(this.recorderType);
    }
}
