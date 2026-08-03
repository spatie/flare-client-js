import { defaultNowNano, type Config, type Span, type SpanOptions, type Tracer } from '@flareapp/core';

import { browserSpanUrlAttributes, collectBrowserSpanContext } from '../browser/context/collectBrowserSpanContext';
import { fill, unfill } from './fill';
import { IdleRootController, type IdleTimeouts } from './IdleRootController';
import { currentPath, type NavigationSource, type RouteName } from './navigation';
import { pageloadEndNano, pageloadStartNano, resolvePageloadStartNano } from './navigationTiming';
import { BrowserSpanType } from './spanTypes';

/** Structural subset of the js Flare this orchestrator needs. */
export type BrowserTracingFlare = {
    readonly config: Config;
    startSpan(name: string, opts?: SpanOptions): Span;
    tracer: Pick<Tracer, 'addSpanListener' | 'setActiveRoot' | 'flush' | 'getActiveSpan'>;
};

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

function resolveTimeouts(config: Config): IdleTimeouts {
    return {
        idleTimeout: config.idleTimeout ?? 1000,
        finalTimeout: config.finalTimeout ?? 30000,
        childSpanTimeout: config.childSpanTimeout ?? 15000,
    };
}

/**
 * Run `fn` against the current root's controller while that root is still open. Swallows a throwing
 * controller: neither ending a prior root nor releasing a hold may stop what the caller does next.
 */
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
};

function startRoot(flare: BrowserTracingFlare, options: StartRootOptions): void {
    const { spanType, startTimeUnixNano, name = location.pathname, urlOverride, hold } = options;
    let root: Span | undefined;
    try {
        root = flare.startSpan(name, {
            spanType,
            startTimeUnixNano,
            forceRoot: true,
            attributes: { ...collectBrowserSpanContext(flare.config, urlOverride), 'flare.route.source': 'url' },
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
                // Childless-close floor: a pageload ends at its real load-event mark,
                // a navigation at its own start (an instant client nav trims to ~0).
                endFloor: spanType === BrowserSpanType.Pageload ? pageloadEndNano : () => startTimeUnixNano,
                held: hold,
            },
            resolveTimeouts(flare.config),
        );
        currentRoot = root;
    } catch (error) {
        // Instrumentation must never break the app. On failure, undo what was half-done (end the
        // orphaned span, clear the active root) and leave tracing switched off rather than throwing.
        controller = null;
        currentRoot = null;
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
 * Start framework-agnostic browser tracing: a backdated `browser_pageload` root, plus
 * `browser_navigation` roots on SPA route changes (History API `pushState`/`replaceState` patch
 * plus `popstate`). No-op outside a browser. Idempotent.
 */
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
    const pageloadStart = resolvePageloadStartNano(
        pageloadStartNano(),
        defaultNowNano(),
        finalTimeoutNano,
        pageloadTraced,
    );
    pageloadTraced = true;
    startRoot(flare, { spanType: BrowserSpanType.Pageload, startTimeUnixNano: pageloadStart });

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
    const endRootAndFlush = (): void => {
        if (controller && !controller.isEnded) {
            try {
                controller.endNow();
            } catch (error) {
                if (flare.config.debug) {
                    console.error('Flare: failed to end tracing root on page hide', error);
                }
            }
        }
        try {
            flare.tracer.flush({ keepalive: true });
        } catch (error) {
            if (flare.config.debug) {
                console.error('Flare: failed to flush spans on page hide', error);
            }
        }
    };
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

/**
 * Stop browser tracing: end the active root and restore the History API. Idempotent.
 * Page-global singleton: stops whatever session is active, not a per-Flare-instance one.
 */
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
}

/**
 * Rename the current root and update the attributes that go with the name. No-op once it closed.
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

    ifRootLive(() => {
        root.name = route.name;
        root.setAttribute('flare.entry_point.handler.identifier', route.name);
        root.setAttribute('flare.route.source', route.source);

        if (route.url === undefined || !activeFlare) {
            return;
        }
        const urlAttrs = browserSpanUrlAttributes(activeFlare.config, route.url);
        for (const key of Object.keys(urlAttrs)) {
            root.setAttribute(key, urlAttrs[key]);
        }
    });
}

/**
 * Register the caller as the page's navigation source. While registered, the
 * built-in History-based navigation detection opens no roots (it still keeps
 * `lastPath` current); the caller drives navigation via the returned handle.
 * Last-wins: a second registration replaces the first, and a stale handle's
 * methods (including `unregister`) no-op — so an HMR-replaced bootstrap cannot
 * tear down a newer registration.
 */
export function registerNavigationSource(): NavigationSource {
    const token = {};
    if (navSource && activeFlare?.config.debug) {
        console.debug('Flare: navigation source replaced');
    }
    navSource = token;
    const active = (): boolean => navSource === token;

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

/**
 * Internal accessor for sibling tracing modules (the component-profiler seam) that
 * need the live tracer. Returns the Flare currently driving browser tracing, or null.
 */
export function activeTracingFlare(): BrowserTracingFlare | null {
    return activeFlare;
}
