import type { Attributes, SpanEvent } from '../types';
import { Recorder } from './Recorder';
import type { BreadcrumbEntry } from './types';

export type SpanEventOptions = {
    type: string;
    attributes: Attributes;
    /** Defaults to now. Pass one when the event's real time is earlier than the moment it was observed. */
    startTimeUnixNano?: number;
    /** Extra fields stamped onto the buffer entry. `GlowRecorder` uses it to keep `Flare.glows` working. */
    entry?: Omit<BreadcrumbEntry, 'event' | 'recorder'>;
};

/**
 * Mirrors PHP's `SpanEventsRecorder`. The point of the helper is that report and trace are two independent
 * decisions: an unsampled trace must never be able to make a breadcrumb disappear from the error report.
 */
export abstract class SpanEventsRecorder extends Recorder {
    protected spanEvent(options: SpanEventOptions): void {
        const span = this.deps.getActiveSpan();
        const shouldTrace = this.withTraces && span !== undefined && span.isRecording;

        if (!this.withErrors && !shouldTrace) {
            return;
        }

        const event: SpanEvent = {
            type: options.type,
            startTimeUnixNano: options.startTimeUnixNano ?? this.deps.nowNano(),
            endTimeUnixNano: null,
            attributes: options.attributes,
        };

        if (this.withErrors) {
            const kept = this.deps.buffer().add({ ...options.entry, event, recorder: this.recorderType }, this.limits);

            // Without this a glow carrying a fat context reads as a glow that never ran. Mirrors the over-budget
            // record drop in TelemetryBuffer.add.
            if (!kept && this.deps.getConfig().debug) {
                console.error(`Flare: dropped a ${options.type} breadcrumb, over maxBreadcrumbEntryBytes`);
            }
        }

        if (shouldTrace) {
            span.addEvent(options.type, options.attributes);
        }
    }
}
