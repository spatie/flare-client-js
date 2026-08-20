import type { Glow, MessageLevel } from '../types';
import { glowToEvent } from '../util/glowsToEvents';
import { SpanEventsRecorder } from './SpanEventsRecorder';
import { RecorderType } from './types';

/**
 * The manual recorder: the one a developer calls directly through `flare.glow()`. PHP treats glows the same
 * way, as one recorder among the automatic ones rather than a special case beside them.
 */
export class GlowRecorder extends SpanEventsRecorder {
    readonly recorderType = RecorderType.Glow;

    record(name: string, level: MessageLevel, data: Record<string, unknown> | Record<string, unknown>[]): void {
        // Derived from the same nowNano clock as every other recorder, so a glow sorts correctly against
        // clicks and requests on the Debug tab timeline instead of drifting on Date.now().
        const microtime = this.deps.nowNano() / 1e9;
        const glow: Glow = {
            name,
            messageLevel: level,
            metaData: data,
            time: Math.floor(microtime),
            microtime,
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
