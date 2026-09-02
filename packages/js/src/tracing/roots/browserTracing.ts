import { defaultNowNano, type Attributes, type Config, type Span, type SpanOptions, type Tracer } from '@flareapp/core';

import { browserSpanUrlAttributes, collectBrowserSpanContext } from '../../browser/context/collectBrowserSpanContext';
import { subscribeToNavigation, isActiveNavigationSource, type RouteName } from '../../instrumentation/navigation';
import { BrowserSpanType } from '../spanTypes';
import {
    buildVitalsSpan,
    restoreWebVitals,
    startWebVitals,
    stopWebVitals,
    takeEarlyVitals,
    takeWebVitals,
    vitalAttributes,
} from '../vitals';
import { resetComponentSelfTime } from './componentSelfTime';
import { DEFAULT_IDLE_TIMEOUTS, IdleRootController, type IdleTimeouts } from './IdleRootController';
import { pageloadEndNano, pageloadStartNano, resolvePageloadStartNano } from './navigationTiming';

// Structural subset of the js Flare this orchestrator needs.
export type BrowserTracingFlare = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
    tracer: Pick<Tracer, 'addSpanListener' | 'setActiveRoot' | 'flush' | 'getActiveSpan' | 'claimSpanSlot'>;
};

// Module state, not per Flare instance: only one browser tracing session runs at a time for the
// whole document, no matter how many Flare instances are on the page.
let controller: IdleRootController | null = null;
let uninstall: (() => void) | null = null;
let removeNavigationSubscription: (() => void) | null = null;
// A document's real pageload window can only be traced once. Stops a re-enable after
// disable from faking a second backdated pageload.
let pageloadTraced = false;

let activeFlare: BrowserTracingFlare | null = null;
let currentRoot: Span | null = null;
// A route name handed over before any root was open, held for the pageload root. Needed when
// an app wires its router before calling configure(), so the initial route still gets applied.
// Stamped with the source's own token, so a source that unregisters or gets replaced before the
// pageload root opens cannot land its name on a root it no longer speaks for.
let pendingRouteName: RouteName | null = null;
let pendingRouteNameOwner: object | null = null;

// The pageload root outlives its own idle close: LCP, CLS and INP only become final at page hide,
// so the emit needs the root's identity and state long after the controller closed.
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

// No-op once the controller has ended. It can close itself via a timer before this
// module's `controller` reference is cleared.
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

// Runs `fn` only while the current root is still open. Swallows a throw, like `withLiveController`.
function ifRootLive(fn: () => void): void {
    withLiveController(() => fn());
}

type StartRootOptions = {
    spanType: BrowserSpanType;
    startTimeUnixNano: number;
    name?: string;
    urlOverride?: string;
    hold?: boolean;
    // Pageloads only: whether the start really is Navigation Timing's navigation start.
    backdated?: boolean;
};

function startRoot(flare: BrowserTracingFlare, options: StartRootOptions): void {
    const { spanType, startTimeUnixNano, name = location.pathname, urlOverride, hold, backdated } = options;
    let root: Span | undefined;
    // Anything still pending belongs to the root this one replaces, and records against a trace
    // that already shipped.
    resetComponentSelfTime();
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
                // Childless-close floor: a backdated pageload ends at its load-event mark, anything
                // else at its own start. A pageload that could not be backdated opened after the load
                // event, so that mark can't be its floor.
                endFloor:
                    spanType === BrowserSpanType.Pageload && backdated ? pageloadEndNano : () => startTimeUnixNano,
                held: hold,
                // Only for a pageload: only a pageload has vitals coming; a navigation root has none.
                beforeEnd: spanType === BrowserSpanType.Pageload ? () => stampEarlyVitals(root!, flare) : undefined,
            },
            resolveTimeouts(flare.config),
        );
        currentRoot = root;
        if (spanType === BrowserSpanType.Pageload) {
            pageloadRoot = root;
            pageloadRootStartNano = startTimeUnixNano;
            pageloadRoute = { name, source: 'url' };
            // Captured now, not at emit time: by page hide the location may have moved on, and the
            // vitals belong to the page that was loaded.
            pageloadContext = { ...context };
        }
    } catch (error) {
        // Instrumentation must never break the app: undo what was half-done and leave tracing off
        // rather than throwing.
        controller = null;
        currentRoot = null;
        if (spanType === BrowserSpanType.Pageload) {
            // Mirrors stopBrowserTracing()'s reset, so a future caller never sees a null root
            // paired with stale pageload data.
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

function openNavigationRoot(flare: BrowserTracingFlare, opts: { path: string; url?: string; hold?: boolean }): void {
    withLiveController((live) => live.endNow());
    startRoot(flare, {
        spanType: BrowserSpanType.Navigation,
        startTimeUnixNano: defaultNowNano(),
        name: opts.path,
        urlOverride: opts.url,
        hold: opts.hold,
    });
}

// Writes the already-final vitals onto the pageload root, from IdleRootController's beforeEnd hook.
// Anything not reported yet stays queued and rides the later browser_web_vital span instead, so no
// vital is sent twice and none is lost.
// Swallows its own failures: this runs inside the root's close path, and a throw here would leave
// the root open forever.
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

// Emits whatever the pageload root could not carry, as one zero-duration browser_web_vital span
// parented to that root. Runs on page hide only, once per document.
// Deliberately not on navigation: LCP, CLS and INP keep moving all document long, so emitting on
// the first route change froze them early, and a session whose first action was a nav click
// reported no INP. One span per document is a backend limit, so the emit waits for page hide
// instead. Cost: a page whose hide event never fires reports no vitals.
// pageloadRoot has usually already ended; reading traceId/spanId off an ended span is fine. Passing
// the Span instead of a { traceId, spanId } pair is what makes sampling inherit, since
// resolveTrace() reads parent.isRecording instead of re-rolling the sampler.
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

    // takeWebVitals is a one-shot latch: once taken, nothing else emits this page's vitals. A throw
    // below must not let that latch stand, or a transient failure silently loses the page's vitals.
    // restoreWebVitals puts the values back so the next trigger can retry.
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

// Opens a backdated pageload root, then a navigation root per History change. No-op outside a browser. Idempotent.
export function startBrowserTracing(flare: BrowserTracingFlare): void {
    if (typeof window === 'undefined' || typeof history === 'undefined' || typeof location === 'undefined') {
        return;
    }
    if (uninstall) {
        return;
    }

    activeFlare = flare;

    removeNavigationSubscription = subscribeToNavigation({
        onUrlChanged: (path) => openNavigationRoot(flare, { path }),
        onNavigationStart: (opts) => openNavigationRoot(flare, opts),
        onRouteName: (route, owner) => applyRouteName(route, owner),
        onNavigationSettle: (route, owner) => {
            applyRouteName(route, owner);
            withLiveController((live) => live.releaseHold());
        },
        onSourceUnregistered: () => {
            // A held root now waits for a settle that never comes (router unmounted or replaced
            // by HMR). Release the hold, or it stays open until finalTimeout closes it.
            withLiveController((live) => live.releaseHold());
            // The pending name came from a source that no longer speaks for this page.
            pendingRouteName = null;
            pendingRouteNameOwner = null;
        },
    });

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
    // configure second) does not decide whether the pageload root gets a url or a route name.
    // Applied only while its owner is still the registered source, so a stale or replaced source
    // cannot mislabel this root.
    if (pendingRouteName) {
        const route = pendingRouteName;
        const owner = pendingRouteNameOwner;
        pendingRouteName = null;
        pendingRouteNameOwner = null;
        if (isActiveNavigationSource(owner)) {
            applyRouteName(route);
        }
    }

    // On page teardown, the open root must be force-ended and keepalive-flushed here:
    // BrowserFlushScheduler's own visibilitychange listener registers earlier, so its flush ran
    // before this root was buffered. Re-flushing an empty buffer is a no-op.
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
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('visibilitychange', onVisibilityChange);
    };
}

// Idempotent.
export function stopBrowserTracing(): void {
    withLiveController((live) => live.endNow());
    controller = null;
    if (uninstall) {
        uninstall();
        uninstall = null;
    }
    removeNavigationSubscription?.();
    removeNavigationSubscription = null;
    activeFlare = null;
    currentRoot = null;
    // Safe to drop even though a source can outlive the stop: while tracing ran there was always a
    // root to name, so nothing was pending, unless startRoot itself failed. A name handed over
    // after this point pends again and still reaches the root a later start opens.
    pendingRouteName = null;
    pendingRouteNameOwner = null;
    stopWebVitals();
    resetComponentSelfTime();
    pageloadRoot = null;
    pageloadRootStartNano = 0;
    pageloadRoute = null;
    pageloadContext = {};
}

// Computes the url attributes a route rename carries, or null when there is nothing to add.
// Guarded so the pin below, which runs outside ifRootLive's own try/catch, cannot throw into the
// host.
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

// Renames the current root, updates its name attributes, and pins the pageload's route for the
// vitals emit. No-op once the root has closed, but the pin below is not gated the same way.
// With no root yet, the name is held for the pageload root that opens next instead of dropped.
// `owner` stamps who is holding it, so a stale or replaced source cannot land its name later.
function applyRouteName(route: RouteName, owner?: object): void {
    const root = currentRoot;
    if (!root) {
        pendingRouteName = route;
        pendingRouteNameOwner = owner ?? null;
        return;
    }

    const urlAttrs = urlAttributesFor(route);

    // Renaming a closed span is correctly a no-op: ifRootLive skips silently once ended.
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
    // Pin outside withLiveController on purpose: the vitals span is built much later, after the
    // pageload root's idle window has closed, so a late router rename must still reach it even
    // though renaming the already-closed root above is skipped.
    pageloadRoute = { name: route.name, source: route.source };
    if (urlAttrs) {
        pageloadContext = { ...pageloadContext, ...urlAttrs };
    }
}

export function activeTracingFlare(): BrowserTracingFlare | null {
    return activeFlare;
}

// Test seams. The emit needs this state; nothing outside this module and its tests reads it.
export function pageloadRootForTests(): Span | null {
    return pageloadRoot;
}

export function pageloadRouteForTests(): { name: string; source: RouteName['source'] } | null {
    return pageloadRoute;
}

export function pageloadContextForTests(): Attributes {
    return pageloadContext;
}
