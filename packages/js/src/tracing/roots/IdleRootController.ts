import type { Span, SpanLifecycleListener, SpanPhase } from '@flareapp/core';

export type IdleTimeouts = {
    idleTimeout: number;
    finalTimeout: number;
    childSpanTimeout: number;
};

// Browser defaults for the three idle-root timeouts, in ms. Overridable per Config.
export const DEFAULT_IDLE_TIMEOUTS: IdleTimeouts = {
    idleTimeout: 1000,
    finalTimeout: 30000,
    childSpanTimeout: 15000,
};

export type IdleRootDeps = {
    root: Span;
    addSpanListener: (fn: SpanLifecycleListener) => () => void;
    setActiveRoot: (span: Span | undefined) => void;
    now: () => number; // unix nanos
    setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
    rootStartTime: number; // unix nanos, base for finalTimeout
    // Where a childless close lands, instead of `now()`. A navigation passes its own start, so an
    // instant nav trims to ~0. A pageload passes the Navigation Timing load-event end, so it reports
    // its real load duration instead of the whole idleTimeout window.
    endFloor: () => number;
    // Suppresses idle-close until releaseHold(), for navigation roots that cannot be named until
    // the router settles, past the idle window. The finalTimeout/childSpanTimeout backstops still apply.
    held?: boolean;
    // Last call before the root's attributes are frozen, since the tracer snapshots them inside
    // `end()`. A pageload stamps its already-final vitals from here. Must not throw; see the call site.
    beforeEnd?: () => void;
};

type Timer = ReturnType<typeof setTimeout> | null;

// Owns one root span's idle lifecycle: open while child spans in its trace are active, closing after
// `idleTimeout` with no open children, or on the `finalTimeout` / `childSpanTimeout` backstops. Deps are
// injected so this is testable without real timers or a real tracer.
export class IdleRootController {
    private openChildren = 0;
    private lastChildEndTime: number | null = null;
    private settleTime: number | null = null;
    private idleTimer: Timer = null;
    private finalTimer: Timer = null;
    private childTimer: Timer = null;
    private ended = false;
    private held = false;
    private unsubscribe: () => void;

    constructor(
        private deps: IdleRootDeps,
        private timeouts: IdleTimeouts,
    ) {
        deps.setActiveRoot(deps.root);
        this.unsubscribe = deps.addSpanListener((e) => this.onSpanEvent(e.phase, e.span));

        const elapsedMs = Math.max(0, (deps.now() - deps.rootStartTime) / 1e6);
        const remainingMs = Math.max(0, timeouts.finalTimeout - elapsedMs);
        this.finalTimer = deps.setTimeout(() => this.finish(deps.now()), remainingMs);

        this.held = !!deps.held;
        this.armIdle();
    }

    get isEnded(): boolean {
        return this.ended;
    }

    // For a route change or pagehide.
    endNow(): void {
        // With no child in flight, trim to the floor instead of padding to the force-end moment. An
        // open child, or a hold (mid loader window), closes at now() instead, so the trace records
        // the work that actually ran.
        this.finish(this.openChildren > 0 || this.held ? this.deps.now() : this.trimmedEnd());
    }

    // Records the settle moment as a close floor and hands the root back to the normal idle
    // lifecycle. Deliberately does not close here: a router settles before the framework mounts the
    // new route component, so closing at settle would clear the active root before every
    // post-navigation mount, leaving component spans and trailing fetches with no root to attach to.
    releaseHold(): void {
        if (this.ended || !this.held) {
            return;
        }
        this.held = false;
        if (this.openChildren === 0) {
            this.settleTime = this.deps.now();
        }
        this.armIdle();
    }

    private onSpanEvent(phase: SpanPhase, span: Span): void {
        if (this.ended) {
            return;
        }
        if (span === this.deps.root) {
            return;
        }
        if (span.traceId !== this.deps.root.traceId) {
            return;
        }

        if (phase === 'start') {
            this.onChildStarted();
            return;
        }
        this.onChildEnded(span);
    }

    private onChildStarted(): void {
        this.openChildren++;
        this.clearIdle();
        // childSpanTimeout is anchored to the 0->1 transition, not each child; a continuously
        // busy root force-ends childSpanTimeout ms after the batch began.
        if (this.openChildren === 1) {
            this.armChildTimeout();
        }
    }

    private onChildEnded(span: Span): void {
        this.openChildren = Math.max(0, this.openChildren - 1);
        // `||` not `??`: 0 is SpanImpl's unset sentinel, so it has to fall back to now() the way SpanImpl
        // itself does.
        this.lastChildEndTime = span.endTimeUnixNano || this.deps.now();
        if (this.openChildren > 0) {
            return;
        }
        this.clearChildTimeout();
        this.armIdle();
    }

    private armIdle(): void {
        this.clearIdle();
        if (this.held) {
            return;
        }
        this.idleTimer = this.deps.setTimeout(() => {
            if (this.openChildren > 0) {
                return;
            }
            this.finish(this.trimmedEnd());
        }, this.timeouts.idleTimeout);
    }

    // The latest of the floor, a released hold's settle moment, and the last child's end, so a
    // root covers its children without padding out to `now()`.
    private trimmedEnd(): number {
        return Math.max(this.deps.endFloor(), this.settleTime ?? 0, this.lastChildEndTime ?? 0);
    }

    private clearIdle(): void {
        if (this.idleTimer !== null) {
            this.deps.clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private armChildTimeout(): void {
        this.childTimer = this.deps.setTimeout(() => this.finish(this.deps.now()), this.timeouts.childSpanTimeout);
    }

    private clearChildTimeout(): void {
        if (this.childTimer !== null) {
            this.deps.clearTimeout(this.childTimer);
            this.childTimer = null;
        }
    }

    private finish(atTimeNano: number): void {
        if (this.ended) {
            return;
        }
        this.ended = true;
        // endFloor and lastChildEndTime come from outside, so clamp: a root may never end before it started.
        atTimeNano = Math.max(atTimeNano, this.deps.rootStartTime);
        this.clearIdle();
        this.clearChildTimeout();
        if (this.finalTimer !== null) {
            this.deps.clearTimeout(this.finalTimer);
            this.finalTimer = null;
        }
        this.unsubscribe();
        this.deps.beforeEnd?.();
        this.deps.root.end(atTimeNano);
        this.deps.setActiveRoot(undefined);
    }
}
