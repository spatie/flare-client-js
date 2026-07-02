import { defaultNowNano, type Config, type Span, type SpanOptions, type Tracer } from '@flareapp/core';

import { fill, unfill } from './fill';
import { IdleRootController, type IdleTimeouts } from './IdleRootController';
import { pageloadStartNano } from './navigationTiming';

/** Structural subset of the js Flare this orchestrator needs. */
export type BrowserTracingFlare = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
    tracer: Pick<Tracer, 'addSpanListener' | 'setActiveRoot'>;
};

let controller: IdleRootController | null = null;
let uninstall: (() => void) | null = null;
let lastPath = '';

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
            attributes: {
                'context.url': location.href,
                'context.route': path,
                'context.user_agent': navigator.userAgent,
                'context.viewport': `${window.innerWidth}x${window.innerHeight}`,
                'flare.entry_point.type': 'web',
            },
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
    startRoot(flare, 'browser_pageload', pageloadStartNano());

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

    uninstall = () => {
        unfill(history as unknown as Record<string, unknown>, 'pushState');
        unfill(history as unknown as Record<string, unknown>, 'replaceState');
        window.removeEventListener('popstate', handle);
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
