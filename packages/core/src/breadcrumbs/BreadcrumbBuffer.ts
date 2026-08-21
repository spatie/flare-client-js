import type { Glow, SpanEvent } from '../types';
import { flatJsonStringify } from '../util/flatJsonStringify';
import { utf8Bytes } from '../util/utf8Bytes';
import { RecorderType, type BreadcrumbEntry, type BreadcrumbLimits } from './types';

type StoredEntry = BreadcrumbEntry & { bytes: number };

/**
 * One buffer per `Scope`, shared by every recorder, drained into `Report.events`. Bounded by entry count
 * and by bytes, because glow context is arbitrary host data and a count alone does not bound the payload.
 */
export class BreadcrumbBuffer {
    private entries: StoredEntry[] = [];
    private bufferedBytes = 0;

    /**
     * @returns false when the entry was over `maxBreadcrumbEntryBytes` and nothing was recorded. A true
     * does not guarantee the entry survives: a `maxBreadcrumbEntryBytes` above `maxBreadcrumbBytes` can
     * still have eviction remove the entry that was just accepted.
     */
    add(entry: BreadcrumbEntry, limits: BreadcrumbLimits): boolean {
        const bytes = utf8Bytes(flatJsonStringify(entry.event));

        // Reject before appending, so an entry on its way to being dropped never evicts real history.
        if (bytes > limits.maxBreadcrumbEntryBytes) {
            return false;
        }

        this.entries.push({ ...entry, bytes });
        this.bufferedBytes += bytes;

        while (
            this.entries.length > 0 &&
            (this.entries.length > limits.maxBreadcrumbs || this.bufferedBytes > limits.maxBreadcrumbBytes)
        ) {
            this.evictOne(limits);
        }

        return true;
    }

    /**
     * Copies rather than handing out the stored objects: a `beforeSubmit` hook that edits `report.events`
     * would otherwise rewrite the buffer for every later report. Attribute values stay shared, as they were
     * before this buffer existed.
     */
    toEvents(): SpanEvent[] {
        return this.entries.map((entry) => ({ ...entry.event, attributes: { ...entry.event.attributes } }));
    }

    glows(): Glow[] {
        const glows: Glow[] = [];
        for (const entry of this.entries) {
            if (entry.glow) {
                glows.push(entry.glow);
            }
        }
        return glows;
    }

    clearRecorder(recorder: RecorderType): void {
        const kept: StoredEntry[] = [];
        for (const entry of this.entries) {
            if (entry.recorder === recorder) {
                this.bufferedBytes -= entry.bytes;
                continue;
            }
            kept.push(entry);
        }
        this.entries = kept;
    }

    get size(): number {
        return this.entries.length;
    }

    get bytes(): number {
        return this.bufferedBytes;
    }

    /**
     * Prefer the oldest non-glow, and fall back to the oldest of any kind once the reserve is all that is
     * left. The caps are hard; the reserve yields to them rather than the other way round.
     */
    private evictOne(limits: BreadcrumbLimits): void {
        let glowCount = 0;
        for (const entry of this.entries) {
            if (entry.recorder === RecorderType.Glow) {
                glowCount++;
            }
        }

        let index = 0;
        if (glowCount <= limits.maxGlowsPerReport) {
            const oldestOther = this.entries.findIndex((entry) => entry.recorder !== RecorderType.Glow);
            index = oldestOther === -1 ? 0 : oldestOther;
        }

        this.bufferedBytes -= this.entries[index].bytes;
        this.entries.splice(index, 1);
    }
}
