import type { FlushFn, FlushScheduler } from '../logging/FlushScheduler';
import type { Attributes, Config } from '../types';
import { assertKey } from '../util';

export type BufferLimits = { maxSize: number; maxBytes: number; flushIntervalMs: number };

export type TelemetryBufferDeps = {
    getConfig: () => Config;
    scheduler: FlushScheduler;
};

// The parts a TelemetryBuffer cannot know by itself: config limits, record size, how to build and send the
// envelope, and what to log on a drop. Logger and SpanBuffer each pass one. Keeps the batching in one place;
// only the send differs (logs vs traces).
export type TelemetryBufferPolicy<TRecord, TEnvelope> = {
    // Read live on every call, never snapshotted. `Flare.configure` replaces `_config` wholesale, so a
    // value captured at construction would freeze the first config forever.
    limits: (config: Config) => BufferLimits;
    // The per-signal enable gate: `enableTracing` for spans, `enableLogs` for logs.
    enabled: (config: Config) => boolean;
    // Soft size of one record, for the weight trigger, the oversized drop and the trim loop.
    estimateBytes: (record: TRecord) => number;
    // UTF-8 bytes of an empty envelope: the fixed overhead every batch has, before any records are added.
    emptyEnvelopeBytes: (resource: Attributes) => number;
    // Exact UTF-8 bytes one record adds to an envelope. Feeds the hard keepalive budget, so no estimating.
    recordBytes: (record: TRecord) => number;
    // Debug message when one record is over `maxBytes` at capture.
    oversizedMessage: string;
    // Debug message when records do not fit the keepalive envelope, summarized per flush.
    keepaliveDropMessage: (count: number) => string;
    // Debug message when building or handing off the envelope throws.
    sendFailureMessage: string;
    // The resource map for this flush. Computed once per flush and threaded into every envelope build.
    resourceForFlush: () => Attributes;
    buildEnvelope: (records: TRecord[], resource: Attributes) => TEnvelope;
    send: (envelope: TEnvelope, config: Config, keepalive: boolean) => void;
    // Runs once a record has been accepted into the buffer, before the flush triggers see it.
    onRecordBuffered?: (record: TRecord) => void;
    // Hard ceiling for one keepalive envelope. Defaults to `config.keepaliveMaxBytes`; a signal that shares
    // the browser's keepalive allowance with another passes what is actually left instead.
    keepaliveBudget?: (config: Config) => number;
};

// `bytes` is measured once at add() and can go stale if a record holds a value by reference the host
// mutates later. Harmless: it only drives the soft weight/trim heuristics, never the hard keepaliveMaxBytes
// limit, which always remeasures fresh through policy.recordBytes.
type BufferEntry<TRecord> = { record: TRecord; bytes: number };

// The batching machine behind both telemetry signals: hold records, ship them when a size, weight or time
// trigger fires, and shed the oldest when nothing can drain. One instance owns one signal; what that signal
// is comes entirely from the policy.
export class TelemetryBuffer<TRecord, TEnvelope> {
    private entries: BufferEntry<TRecord>[] = [];
    // Running total of every entry's `bytes`. Kept in step at each mutation site: the push in add(), the drain
    // and the keepalive residue in flush(), both drops in trim(), and clear().
    private bufferedBytes = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private timerActive = false;

    constructor(
        private deps: TelemetryBufferDeps,
        private policy: TelemetryBufferPolicy<TRecord, TEnvelope>,
    ) {
        const flush: FlushFn = (opts) => this.flush(opts);
        this.deps.scheduler.register(flush);
    }

    length(): number {
        return this.entries.length;
    }

    add(record: TRecord): void {
        const config = this.deps.getConfig();
        // Consent gate: never buffer without consent, so a later grant cannot ship data captured now.
        if (config.hasConsent === false) {
            return;
        }
        const limits = this.policy.limits(config);
        const bytes = this.policy.estimateBytes(record);
        // A single record over the ceiling could never ship, and the trim loop could never get the buffer back
        // under the ceiling while it sits there. Drop it at capture instead.
        if (bytes > limits.maxBytes) {
            if (config.debug) {
                console.error(this.policy.oversizedMessage);
            }
            return;
        }

        this.entries.push({ record, bytes });
        this.bufferedBytes += bytes;
        this.policy.onRecordBuffered?.(record);

        // Triggers run before the trim: a keyed over-cap push flushes-and-clears here (data shipped); the trim is
        // only the safety net when the flush no-ops (no key).
        this.evaluateTriggers(config, limits);
        this.trim(limits);
    }

    flush(opts?: { keepalive?: boolean }): void {
        const config = this.deps.getConfig();
        if (!this.policy.enabled(config)) {
            return;
        }
        if (this.entries.length === 0) {
            return;
        }

        // Consent gate: safety net beside the key gate. `add()` already refuses to buffer without consent,
        // so this only guards a records-in-flight edge; it never sends.
        if (config.hasConsent === false) {
            this.clearTimer();
            return;
        }

        // Key gate: never send unauthenticated. assertKey (not bare truthiness) logs the same missing-key
        // diagnostic as reports in debug mode. Resets the timer but keeps the buffer until a key is set.
        if (!assertKey(config.key, config.debug)) {
            this.clearTimer();
            return;
        }
        this.clearTimer();

        const resource = this.policy.resourceForFlush();

        let selected: BufferEntry<TRecord>[];
        let sendKeepalive = !!opts?.keepalive;
        if (opts?.keepalive) {
            selected = this.packForKeepalive(config, resource);
            if (selected.length === 0) {
                // Nothing fits what is left of the shared budget. Sending the whole buffer without keepalive
                // beats losing it silently on an unloading page, and keeps a trace whole instead of dropping
                // a fat root while shipping its leaner children (this buffer does not track traceId).
                selected = this.entries;
                this.entries = [];
                this.bufferedBytes = 0;
                sendKeepalive = false;
            } else {
                this.entries = this.entries.filter((entry) => !selected.includes(entry));
                // Summed from what is retained rather than subtracted, because summing cached numbers is cheap
                // and cannot drift out of step with the filter.
                this.bufferedBytes = this.entries.reduce((sum, entry) => sum + entry.bytes, 0);
                // Re-arm the interval so retained records flush on resume without waiting for the next capture.
                if (this.entries.length > 0) {
                    this.armTimer(this.policy.limits(config));
                }
            }
        } else {
            selected = this.entries;
            this.entries = [];
            this.bufferedBytes = 0;
        }
        if (selected.length === 0) {
            return;
        }

        // A throwing resource getter escapes this try on purpose. Widening the try would leave the buffer
        // undrained and retry a poison record forever. A proper fix needs a drain-then-guard redesign.
        try {
            this.policy.send(
                this.policy.buildEnvelope(
                    selected.map((entry) => entry.record),
                    resource,
                ),
                config,
                sendKeepalive,
            );
        } catch (error) {
            // The buffer is already drained above, so this batch is gone either way.
            if (config.debug) {
                console.error(this.policy.sendFailureMessage, error);
            }
        }
    }

    clear(): void {
        this.entries = [];
        this.bufferedBytes = 0;
        this.clearTimer();
    }

    private evaluateTriggers(config: Config, limits: BufferLimits): void {
        if (this.entries.length >= limits.maxSize) {
            this.flush();
            return;
        }
        if (this.bufferedBytes >= limits.maxBytes) {
            this.flush();
            return;
        }
        this.armTimer(limits);
    }

    private armTimer(limits: BufferLimits): void {
        if (this.timerActive) {
            return;
        }
        this.timerActive = true;
        this.timer = setTimeout(() => {
            // Reset before flushing: flush()'s early returns skip clearTimer(), which would otherwise leave a
            // dead handle behind and block armTimer for the rest of the buffer's life.
            this.timerActive = false;
            this.timer = undefined;
            this.flush();
        }, limits.flushIntervalMs);
        // Node's Timeout has unref(); the browser's number does not.
        (this.timer as { unref?: () => void }).unref?.();
    }

    private trim(limits: BufferLimits): void {
        if (this.entries.length > limits.maxSize) {
            const excess = this.entries.length - limits.maxSize;
            for (let i = 0; i < excess; i++) {
                this.bufferedBytes -= this.entries[i].bytes;
            }
            this.entries = this.entries.slice(excess);
        }
        // Never trim to empty: a lone record over the ceiling cannot be fixed by dropping it, and add() already
        // refused anything that large on the way in.
        while (this.entries.length > 1 && this.bufferedBytes > limits.maxBytes) {
            const dropped = this.entries.shift();
            if (dropped) {
                this.bufferedBytes -= dropped.bytes;
            }
        }
    }

    // Newest first. Skip an over-budget record instead of stopping, so a smaller older record still ships.
    private packForKeepalive(config: Config, resource: Attributes): BufferEntry<TRecord>[] {
        // Sized from parts instead of rebuilding the envelope per candidate: fixed overhead once, each record's
        // own UTF-8 length, plus one byte per record after the first for the JSON array comma.
        const fixedBytes = this.policy.emptyEnvelopeBytes(resource);
        const budget = Math.min(
            config.keepaliveMaxBytes,
            this.policy.keepaliveBudget?.(config) ?? config.keepaliveMaxBytes,
        );
        const selected: BufferEntry<TRecord>[] = [];
        let selectedBytes = 0;
        let droppedCount = 0;

        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            const candidateBytes = this.policy.recordBytes(entry.record);
            // selected.length is the comma count the array will have once this candidate joins it.
            if (fixedBytes + selectedBytes + candidateBytes + selected.length <= budget) {
                selected.unshift(entry);
                selectedBytes += candidateBytes;
            } else if (config.debug) {
                droppedCount++;
            }
        }
        // One line per flush, not one per record: a plain tab-switch can skip a whole buffer's worth of records.
        if (config.debug && droppedCount > 0) {
            console.error(this.policy.keepaliveDropMessage(droppedCount));
        }
        return selected;
    }

    private clearTimer(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.timerActive = false;
    }
}
