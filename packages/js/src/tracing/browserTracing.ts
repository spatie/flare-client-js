import { defaultNowNano, type Attributes, type Config, type Span, type SpanOptions, type Tracer } from '@flareapp/core';

import { browserSpanUrlAttributes, collectBrowserSpanContext } from '../browser/context/collectBrowserSpanContext';
import { fill, unfill } from './fill';
import { DEFAULT_IDLE_TIMEOUTS, IdleRootController, type IdleTimeouts } from './IdleRootController';
import { currentPath, type NavigationSource, type RouteName } from './navigation';
import { pageloadEndNano, pageloadStartNano, resolvePageloadStartNano } from './navigationTiming';
import { BrowserSpanType } from './spanTypes';
import {
    buildVitalsSpan,
    restoreWebVitals,
    startWebVitals,
    stopWebVitals,
    takeEarlyVitals,
    takeWebVitals,
    vitalAttributes,
} from './webVitals';

/** Structural subset of the js Flare this orchestrator needs. */
export type BrowserTracingFlare = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
    tracer: Pick<Tracer, 'addSpanListener' | 'setActiveRoot' | 'flush' | 'getActiveSpan'>;
};

// Module state, not per-Flare-instance: one browser tracing session runs at a time for the whole
// document, no matter how many Flare instances are configured on the page.
let controller: IdleRootController | null = null;
let uninstall: (() => void) | null = null;
let lastPath = '';
// Page-global: a document's real pageload window can only be traced once. Guards against
// re-enabling after a disable fabricating a second backdated pageload.
let pageloadTraced = false;

let navSource: object | null = null;
let activeFlare: BrowserTracingFlare | null = null;
let currentRoot: Span | null = null;
// A route name a navigation source handed over while no root was open, kept for the pageload root. An
// app that installs its router integration before calling configure() names its initial route before
// the pageload root exists, and nothing would ever name that root a second time.
// Stamped with the source's own token, so a source that unregisters or gets superseded before the
// pageload root opens cannot still land its name on a root it no longer speaks for.
let pendingRouteName: RouteName | null = null;
let pendingRouteNameOwner: object | null = null;

// The pageload root outlives its own idle close: LCP, CLS and INP are only final at page hide, so the
// emit needs the root's identity and the state that went with it long after the controller closed.
let pageloadRoot: Span | null = null;
let pageloadRootStartNano = 0;
let pageloadRoute: { name: string; source: RouteName['source'] } | null = null;
let pageloadContext: Attributes = {};

function resolveTimeouts(config: Config): IdleTimeouts {
    return {
        idleTimeout: config.idleTimeout ?? DEFAULT_IDLE_TIMEOUTS.idleTimeout,
        finalTimeout: config.finalTimeout ?? DEFAULT_IDLE_TIMEOUTS.finalTimeout,
        childSpanTimeout: config.childSpanTimeout ?? DEFAULT_IDLE_TIMEOUTS.childSpanTimeout,
    };
}

/** No-ops once the controller has ended: it can close itself asynchronously via a timer, before this
 *  module's `controller` reference is cleared. */
function withLiveController(fn: (live: IdleRootController) => void): void {
    if (!controller || controller.isEnded) {
        return;
    }
    try {
        fn(controller);
    } catch (error) {
        // instrumentation must never throw into the host app
        if (activeFlare?.config.debug) {
            console.error('Flare: browser tracing controller callback failed', error);
        }
    }
}

/** Run `fn` only while the current root is still open. Swallows a throw, like `withLiveController`. */
function ifRootLive(fn: () => void): void {
    withLiveController(() => fn());
}

type StartRootOptions = {
    spanType: BrowserSpanType;
    startTimeUnixNano: number;
    name?: string;
    urlOverride?: string;
    hold?: boolean;
    /** Pageloads only: whether the start really is Navigation Timing's navigation start. */
    backdated?: boolean;
};

function startRoot(flare: BrowserTracingFlare, options: StartRootOptions): void {
    const { spanType, startTimeUnixNano, name = location.pathname, urlOverride, hold, backdated } = options;
    let root: Span | undefined;
    try {
        const context = collectBrowserSpanContext(flare.config, urlOverride);
        root = flare.startSpan(name, {
            spanType,
            startTimeUnixNano,
            forceRoot: true,
            attributes: { ...context, 'flare.route.source': 'url' },
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
                // Childless-close floor: a backdated pageload ends at its load-event mark, anything else
                // at its own start. A pageload that could not be backdated opened after the load event,
                // so that mark is before its start and cannot be its floor.
                endFloor:
                    spanType === BrowserSpanType.Pageload && backdated ? pageloadEndNano : () => startTimeUnixNano,
                held: hold,
                // Only a pageload: the vitals describe the document load, and a navigation root has
                // none of its own coming.
                beforeEnd: spanType === BrowserSpanType.Pageload ? () => stampEarlyVitals(root!, flare) : undefined,
            },
            resolveTimeouts(flare.config),
        );
        currentRoot = root;
        if (spanType === BrowserSpanType.Pageload) {
            pageloadRoot = root;
            pageloadRootStartNano = startTimeUnixNano;
            pageloadRoute = { name, source: 'url' };
            // Captured here, not at emit time: by page hide the location may have moved on, and the
            // vitals belong to the page that was loaded.
            pageloadContext = { ...context };
        }
    } catch (error) {
        // Instrumentation must never break the app. On failure, undo what was half-done (end the
        // orphaned span, clear the active root) and leave tracing switched off rather than throwing.
        controller = null;
        currentRoot = null;
        if (spanType === BrowserSpanType.Pageload) {
            // Mirrors stopBrowserTracing()'s reset: nothing reads this state yet, but a future
            // caller added after this stash block must not see a null root paired with stale data.
            pageloadRoot = null;
            pageloadRootStartNano = 0;
            pageloadRoute = null;
            pageloadContext = {};
        }
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
        if (flare.config.debug) {
            console.error('Flare: failed to start browser tracing root', error);
        }
    }
}

function onUrlChanged(flare: BrowserTracingFlare): void {
    const path = location.pathname;
    if (path === lastPath) {
        return;
    }
    lastPath = path;
    // a framework integration drives navigation; keep lastPath current, open no root
    if (navSource) {
        return;
    }
    withLiveController((live) => live.endNow());
    startRoot(flare, { spanType: BrowserSpanType.Navigation, startTimeUnixNano: defaultNowNano(), name: path });
}

/**
 * Writes the already-final vitals onto the pageload root itself, from `IdleRootController`'s beforeEnd
 * hook. Whatever has not reported yet stays in `collected` and rides the later `browser_web_vital`
 * span instead, so no vital is ever sent twice and none is lost.
 *
 * Swallows its own failures: this runs inside the root's close path, and a throw here would leave the
 * root open forever.
 */
function stampEarlyVitals(root: Span, flare: BrowserTracingFlare): void {
    try {
        const early = takeEarlyVitals();
        if (!early) {
            return;
        }
        for (const [key, value] of Object.entries(vitalAttributes(early))) {
            root.setAttribute(key, value);
        }
    } catch (error) {
        if (flare.config.debug) {
            console.error('Flare: failed to stamp web vitals on the pageload root', error);
        }
    }
}

/**
 * Emits whatever the pageload root could not carry as one zero-duration `browser_web_vital` span,
 * parented to that root. Page hide only, and once per document.
 *
 * Deliberately NOT on navigation: LCP, CLS and INP keep moving all document long, so emitting at the
 * first route change froze them a second after load, and a session whose first action was a nav click
 * reported no INP at all. One span per document is a backend constraint, so the emit waits for the last
 * moment we get instead. The cost is a page whose hide event never fires reports no vitals.
 *
 * `pageloadRoot` has usually ended by now; reading `traceId` and `spanId` off an ended span is fine,
 * and passing the `Span` rather than a `{ traceId, spanId }` pair is what makes sampling inherit:
 * `resolveTrace()` reads `parent.isRecording` instead of re-rolling the sampler.
 */
function emitWebVitals(flare: BrowserTracingFlare): void {
    const root = pageloadRoot;
    const route = pageloadRoute;
    if (!root || !route) {
        return;
    }
    const vitals = takeWebVitals();
    if (!vitals) {
        return;
    }

    // The take above is a one-shot latch: once taken, nothing else will ever emit this page's
    // vitals. A throw anywhere below must not let that latch stand, or a transient tracer failure
    // silently costs the whole page view. `restoreWebVitals` puts the values back for the next trigger.
    try {
        const planned = buildVitalsSpan({
            vitals,
            rootStartTimeUnixNano: pageloadRootStartNano,
            routeName: route.name,
            routeSource: route.source,
            contextAttributes: pageloadContext,
        });
        if (!planned) {
            return;
        }

        flare
            .startSpan(planned.name, {
                parent: root,
                forceRoot: true,
                spanType: BrowserSpanType.WebVital,
                startTimeUnixNano: planned.startTimeUnixNano,
                attributes: planned.attributes,
            })
            .end(planned.endTimeUnixNano);
    } catch (error) {
        restoreWebVitals(vitals);
        if (flare.config.debug) {
            console.error('Flare: failed to emit web vitals', error);
        }
    }
}

/** Opens a backdated pageload root, then a navigation root per History change. No-op outside a browser. Idempotent. */
export function startBrowserTracing(flare: BrowserTracingFlare): void {
    if (typeof window === 'undefined' || typeof history === 'undefined' || typeof location === 'undefined') {
        return;
    }
    if (uninstall) {
        return;
    }

    activeFlare = flare;
    lastPath = location.pathname;

    const finalTimeoutNano = resolveTimeouts(flare.config).finalTimeout * 1e6;
    const navigationStart = pageloadStartNano();
    const pageloadStart = resolvePageloadStartNano(navigationStart, defaultNowNano(), finalTimeoutNano, pageloadTraced);
    pageloadTraced = true;
    startRoot(flare, {
        spanType: BrowserSpanType.Pageload,
        startTimeUnixNano: pageloadStart,
        backdated: pageloadStart === navigationStart,
    });
    startWebVitals();

    // Named from the route the source already knows, so install order (router integration first,
    // configure second) does not decide whether the pageload root carries a url or a route name.
    // Only applied while its owner is still the registered source: a name held by a source that has
    // since unregistered or been superseded is dropped instead of mislabeling this root.
    if (pendingRouteName) {
        const route = pendingRouteName;
        const owner = pendingRouteNameOwner;
        pendingRouteName = null;
        pendingRouteNameOwner = null;
        if (owner === navSource) {
            applyRouteName(route);
        }
    }

    const handle = (): void => {
        // A third party may wrap history.pushState/replaceState on top of ours, so unfill can't
        // restore on stop and this closure is left behind. `uninstall` doubles as the installed flag,
        // so that leftover wrapper does nothing instead of starting roots and timers while tracing is off.
        if (!uninstall) {
            return;
        }
        try {
            onUrlChanged(flare);
        } catch (error) {
            if (flare.config.debug) {
                console.error('Flare: browser tracing navigation handler failed', error);
            }
        }
    };
    function wrapHistoryMethod<F extends (...args: never[]) => unknown>(original: F): F {
        return function (this: unknown, ...args: Parameters<F>): unknown {
            const result = original.apply(this, args);
            handle();
            return result;
        } as F;
    }

    fill(history, 'pushState', wrapHistoryMethod);
    fill(history, 'replaceState', wrapHistoryMethod);
    window.addEventListener('popstate', handle);

    // On page teardown the open root must be force-ended and then keepalive-flushed from here:
    // BrowserFlushScheduler's own visibilitychange listener registered earlier, so when it flushed
    // the just-ended root was not buffered yet. Re-flushing an empty buffer is a no-op.
    function endRootAndFlush(): void {
        if (controller && !controller.isEnded) {
            try {
                controller.endNow();
            } catch (error) {
                if (flare.config.debug) {
                    console.error('Flare: failed to end tracing root on page hide', error);
                }
            }
        }
        emitWebVitals(flare);
        try {
            flare.tracer.flush({ keepalive: true });
        } catch (error) {
            if (flare.config.debug) {
                console.error('Flare: failed to flush spans on page hide', error);
            }
        }
    }
    const onPageHide = (): void => endRootAndFlush();
    const onVisibilityChange = (): void => {
        if (document.visibilityState === 'hidden') {
            endRootAndFlush();
        }
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);

    uninstall = () => {
        unfill(history, 'pushState');
        unfill(history, 'replaceState');
        window.removeEventListener('popstate', handle);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };
}

/** Idempotent. */
export function stopBrowserTracing(): void {
    withLiveController((live) => live.endNow());
    controller = null;
    if (uninstall) {
        uninstall();
        uninstall = null;
    }
    activeFlare = null;
    currentRoot = null;
    // Safe to drop even though a source can outlive the stop: while tracing ran there was a root to
    // name, so nothing was pending, unless startRoot itself failed. A name handed over after this
    // point pends again and still reaches the root a later start opens.
    pendingRouteName = null;
    pendingRouteNameOwner = null;
    lastPath = '';
    stopWebVitals();
    pageloadRoot = null;
    pageloadRootStartNano = 0;
    pageloadRoute = null;
    pageloadContext = {};
}

/**
 * Computes the url attributes a route rename carries, or null when there is nothing to add. Guarded
 * so the pin below (which runs outside ifRootLive's own try/catch) cannot throw into the host.
 */
function urlAttributesFor(route: RouteName): Attributes | null {
    if (route.url === undefined || !activeFlare) {
        return null;
    }
    try {
        return browserSpanUrlAttributes(activeFlare.config, route.url);
    } catch {
        return null;
    }
}

/**
 * Rename the current root and update the attributes that go with the name, and pin the pageload's route
 * for the vitals emit. No-op once it closed; the pin is NOT gated the same way, see below.
 * With no root yet the name is held for the pageload root that opens next, rather than dropped.
 * `owner` stamps who is holding it, so a stale or superseded source cannot land its name later.
 */
function applyRouteName(route: RouteName, owner?: object): void {
    const root = currentRoot;
    if (!root) {
        pendingRouteName = route;
        pendingRouteNameOwner = owner ?? null;
        return;
    }

    const urlAttrs = urlAttributesFor(route);

    // Renaming a closed span is correctly a no-op: ifRootLive skips silently once the root's
    // controller has ended.
    ifRootLive(() => {
        root.name = route.name;
        root.setAttribute('flare.entry_point.handler.identifier', route.name);
        root.setAttribute('http.route', route.name);
        root.setAttribute('flare.route.source', route.source);
        if (!urlAttrs) {
            return;
        }
        for (const [key, value] of Object.entries(urlAttrs)) {
            root.setAttribute(key, value);
        }
    });

    if (root !== pageloadRoot) {
        return;
    }
    // Pin outside withLiveController, deliberately: the vitals container is created much later,
    // long after the pageload root's idle window has closed, so a late router rename must still
    // reach it even though the rename of the (already-closed) root above is correctly skipped.
    pageloadRoute = { name: route.name, source: route.source };
    if (urlAttrs) {
        pageloadContext = { ...pageloadContext, ...urlAttrs };
    }
}

/**
 * While registered, the built-in History detection opens no roots and the caller drives navigation
 * through the returned handle. Last-wins, and a stale handle no-ops, so an HMR-replaced bootstrap
 * cannot tear down a newer registration.
 */
export function registerNavigationSource(): NavigationSource {
    const token = {};
    if (navSource && activeFlare?.config.debug) {
        console.debug('Flare: navigation source replaced');
    }
    navSource = token;
    function active(): boolean {
        return navSource === token;
    }

    return {
        startNavigation(opts) {
            if (!active() || !activeFlare) {
                return;
            }
            const path = opts?.path ?? currentPath();
            lastPath = path;
            withLiveController((live) => live.endNow());
            startRoot(activeFlare, {
                spanType: BrowserSpanType.Navigation,
                startTimeUnixNano: defaultNowNano(),
                name: path,
                urlOverride: opts?.url,
                hold: opts?.hold,
            });
        },
        setActiveRouteName(route) {
            if (!active()) {
                return;
            }
            applyRouteName(route, token);
        },
        settleNavigation(route) {
            if (!active()) {
                return;
            }
            applyRouteName(route, token);
            withLiveController((live) => live.releaseHold());
        },
        unregister() {
            if (!active()) {
                return;
            }
            // Release any hold so a navigation root opened held (awaiting a settle that will now
            // never come, e.g. route-provider unmount or HMR mid-navigation) does not stay
            // idle-suppressed until the finalTimeout force-close. A childless root then closes now;
            // one with an open child resumes the normal idle lifecycle.
            withLiveController((live) => live.releaseHold());
            navSource = null;
            lastPath = currentPath();
            // A name this source handed over before any root picked it up is now for a page this
            // source no longer traces; a later pageload root must not inherit it.
            pendingRouteName = null;
            pendingRouteNameOwner = null;
        },
    };
}

/** For sibling tracing modules (the component-profiler seam) that need the live tracer. */
export function activeTracingFlare(): BrowserTracingFlare | null {
    return activeFlare;
}

/** Test seams. The emit needs this state; nothing outside this module and its tests reads it. */
export function pageloadRootForTests(): Span | null {
    return pageloadRoot;
}

export function pageloadRouteForTests(): { name: string; source: RouteName['source'] } | null {
    return pageloadRoute;
}

export function pageloadContextForTests(): Attributes {
    return pageloadContext;
}
