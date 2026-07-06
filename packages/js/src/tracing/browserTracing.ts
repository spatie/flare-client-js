import { defaultNowNano, type Config, type Span, type SpanOptions, type Tracer } from '@flareapp/core';

import { collectBrowserSpanContext } from '../browser/context/collectBrowserSpanContext';
import { fill, unfill } from './fill';
import { IdleRootController, type IdleTimeouts } from './IdleRootController';
import { pageloadStartNano, resolvePageloadStartNano } from './navigationTiming';

/** Structural subset of the js Flare this orchestrator needs. */
export type BrowserTracingFlare = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
    tracer: Pick<Tracer, 'addSpanListener' | 'setActiveRoot' | 'flush'>;
};

let controller: IdleRootController | null = null;
let uninstall: (() => void) | null = null;
let lastPath = '';
// Page-global: a document's real pageload window can only be traced once. Guards
// against re-enabling after a disable fabricating a second backdated pageload.
let pageloadTraced = false;

function resolveTimeouts(config: Config): IdleTimeouts {
    return {
        idleTimeout: config.idleTimeout ?? 1000,
        finalTimeout: config.finalTimeout ?? 30000,
        childSpanTimeout: config.childSpanTimeout ?? 15000,
    };
}

function startRoot(flare: BrowserTracingFlare, spanType: string, startTimeUnixNano: number): void {
    const path = location.pathname;
    let root: Span | undefined;
    try {
        root = flare.startSpan(path, {
            spanType,
            startTimeUnixNano,
            forceRoot: true,
            attributes: collectBrowserSpanContext(flare.config),
        });
        controller = new IdleRootController(
            {
                root,
                addSpanListener: (fn) => flare.tracer.addSpanListener(fn),
                setActiveRoot: (span) => flare.tracer.setActiveRoot(span),
                now: defaultNowNano,
                setTimeout: (fn, ms) => setTimeout(fn, ms),
                clearTimeout: (handle) => clearTimeout(handle),
                rootStartTime: startTimeUnixNano,
            },
            resolveTimeouts(flare.config),
        );
    } catch (error) {
        // Instrumentation must never break the app. If root creation or the idle
        // controller fails, undo any partial state (end the orphaned span, clear
        // the active root) and leave tracing inert rather than throwing.
        controller = null;
        try {
            root?.end();
        } catch {
            // ignore
        }
        try {
            flare.tracer.setActiveRoot(undefined);
        } catch {
            // ignore
        }
        if (flare.config.debug) console.error('Flare: failed to start browser tracing root', error);
    }
}

function onUrlChanged(flare: BrowserTracingFlare): void {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    if (controller && !controller.isEnded) {
        try {
            controller.endNow();
        } catch {
            // A failing prior-root teardown must not stop the new root from starting.
        }
    }
    startRoot(flare, 'browser_navigation', defaultNowNano());
}

/**
 * Start framework-agnostic browser tracing: a backdated `browser_pageload` root,
 * plus `browser_navigation` roots on SPA route changes detected by patching the
 * History API (`pushState`/`replaceState`) and listening for `popstate`.
 * No-op outside a browser. Idempotent (a second call while running is ignored).
 */
export function startBrowserTracing(flare: BrowserTracingFlare): void {
    if (typeof window === 'undefined' || typeof history === 'undefined' || typeof location === 'undefined') return;
    if (uninstall) return;

    lastPath = location.pathname;

    const finalTimeoutNano = resolveTimeouts(flare.config).finalTimeout * 1e6;
    const pageloadStart = resolvePageloadStartNano(
        pageloadStartNano(),
        defaultNowNano(),
        finalTimeoutNano,
        pageloadTraced,
    );
    pageloadTraced = true;
    startRoot(flare, 'browser_pageload', pageloadStart);

    const handle = (): void => {
        try {
            onUrlChanged(flare);
        } catch (error) {
            if (flare.config.debug) console.error('Flare: browser tracing navigation handler failed', error);
        }
    };
    const wrap = (original: unknown) =>
        function (this: unknown, ...args: unknown[]): unknown {
            const result = (original as (...a: unknown[]) => unknown).apply(this, args);
            handle();
            return result;
        };
    fill(history as unknown as Record<string, unknown>, 'pushState', wrap);
    fill(history as unknown as Record<string, unknown>, 'replaceState', wrap);
    window.addEventListener('popstate', handle);

    // On page teardown the open root must be force-ended (Sentry does the same on
    // pagehide) and then keepalive-flushed from HERE: BrowserFlushScheduler's own
    // visibilitychange listener registered earlier, so by the time it flushed the
    // just-ended root was not buffered yet. Re-flushing an empty buffer is a no-op.
    const endRootAndFlush = (): void => {
        if (controller && !controller.isEnded) {
            try {
                controller.endNow();
            } catch (error) {
                if (flare.config.debug) console.error('Flare: failed to end tracing root on page hide', error);
            }
        }
        try {
            flare.tracer.flush({ keepalive: true });
        } catch (error) {
            if (flare.config.debug) console.error('Flare: failed to flush spans on page hide', error);
        }
    };
    const onPageHide = (): void => endRootAndFlush();
    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') endRootAndFlush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    uninstall = () => {
        unfill(history as unknown as Record<string, unknown>, 'pushState');
        unfill(history as unknown as Record<string, unknown>, 'replaceState');
        window.removeEventListener('popstate', handle);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };
}

/**
 * Stop browser tracing: end the active root and restore the History API. Idempotent.
 * Page-global singleton: stops whatever tracing session is active, not a per-Flare-instance session.
 */
export function stopBrowserTracing(): void {
    if (controller && !controller.isEnded) controller.endNow();
    controller = null;
    if (uninstall) {
        uninstall();
        uninstall = null;
    }
    lastPath = '';
}
