import { Api, Flare as CoreFlare } from '@flareapp/core';

import { DEFAULT_BODY_CONTENT_TYPES, DEFAULT_BODY_KEY_DENYLIST } from './context/body';
import { makeNodeContextCollector } from './context/collectNode';
import { DEFAULT_HEADER_DENYLIST, resolveHeaderDenylist } from './context/headers';
import { buildFatalCallbacks } from './process/fatal';
import { ProcessHandlerManager } from './process/handlers';
import { AsyncLocalStorageScopeProvider } from './scope/AsyncLocalStorageScopeProvider';
import type { NodeScope } from './scope/NodeScope';
import { DiskFileReader } from './stacktrace/DiskFileReader';
import type { NodeOptions, RequestContext, ResolvedNodeOptions, User } from './types';

const NODE_SDK_NAME = '@flareapp/node';
const NODE_SDK_VERSION =
    typeof process !== 'undefined' && process.env?.FLARE_JS_CLIENT_VERSION !== undefined
        ? process.env.FLARE_JS_CLIENT_VERSION
        : '?';

/**
 * Strip the `g` and `y` flags from a user-supplied regex.
 *
 * `RegExp.prototype.test()` and `.exec()` keep `lastIndex` state when either of
 * these flags is set, which means reusing the same regex across many keys (as
 * the header denylist and body redaction do) silently skips matches after the
 * first hit. Reconstructing the regex without those flags gives stateless
 * matching while preserving everything else (`i`, `m`, `s`, `u`, source).
 */
function sanitizeRegex(re: RegExp): RegExp {
    const safeFlags = re.flags.replace(/[gy]/g, '');
    return new RegExp(re.source, safeFlags);
}

const DEFAULT_NODE_OPTIONS: ResolvedNodeOptions = {
    uncaughtExceptionMode: 'report-and-exit',
    unhandledRejectionMode: 'report-and-exit',
    shutdownTimeoutMs: 2000,
    headerDenylist: DEFAULT_HEADER_DENYLIST,
    headerAllowlist: null,
    replaceDefaultHeaderDenylist: false,
    captureRequestBody: false,
    bodyMaxBytes: 16_384,
    bodyAllowedContentTypes: DEFAULT_BODY_CONTENT_TYPES,
    bodyKeyDenylist: DEFAULT_BODY_KEY_DENYLIST,
};

/**
 * Node.js-specific `Flare` singleton, exposed from `@flareapp/node` as `flare`.
 *
 * Subclasses core's `Flare` and wires the Node-only seams in its constructor:
 *
 * - `AsyncLocalStorageScopeProvider` so each `runWithContext(...)` callback
 *   gets its own `NodeScope` (glows, attributes, user, entry-point, request),
 *   isolated from concurrent requests.
 * - `makeNodeContextCollector(...)` to project the current `NodeScope` and
 *   process info into report attributes (http.request.*, url.path, etc).
 * - `DiskFileReader` to read source files for stack-trace snippets via
 *   `node:fs/promises` instead of the browser's `fetch`.
 * - `ProcessHandlerManager` to attach/detach `uncaughtException` and
 *   `unhandledRejection` listeners based on the current `NodeOptions`.
 *
 * Also adds Node-only API surface on top of core: `configureNode(...)`,
 * `runWithContext(...)`, `mergeContext(...)`, `setUser(...)`, `getContext()`,
 * `removeProcessListeners()`. Inherited core methods (`light`, `configure`,
 * `addContext`, `glow`, etc.) return `this`, so chaining keeps the
 * `NodeFlare` type and `configureNode(...)` stays callable mid-chain.
 */
export class NodeFlare extends CoreFlare {
    private nodeOptions: ResolvedNodeOptions = { ...DEFAULT_NODE_OPTIONS };
    private isLit = false;
    private nodeScopeProvider: AsyncLocalStorageScopeProvider;
    private handlerManager: ProcessHandlerManager;

    constructor() {
        const scopeProvider = new AsyncLocalStorageScopeProvider();
        // The collector closes over `() => this.nodeOptions` (a getter, not a
        // value) so subsequent `configureNode(...)` calls take effect on
        // future reports without reinjecting the collector.
        const collector = makeNodeContextCollector(scopeProvider, () => this.nodeOptions);
        super(new Api(), collector, new DiskFileReader(), scopeProvider);
        this.nodeScopeProvider = scopeProvider;
        this.setSdkInfo({ name: NODE_SDK_NAME, version: NODE_SDK_VERSION });

        const cbs = buildFatalCallbacks(this, () => this.nodeOptions);
        this.handlerManager = new ProcessHandlerManager(cbs);
    }

    /**
     * Set the API key (and optional debug flag), then reconcile process
     * listeners with the current `nodeOptions`. Reconcile runs on EVERY call,
     * not just the first, so `light()` is the right escape hatch to re-attach
     * after `removeProcessListeners()`.
     */
    light(key?: string, debug?: boolean) {
        super.light(key, debug);
        this.isLit = true;
        this.handlerManager.reconcile(this.nodeOptions);
        return this;
    }

    /**
     * Merge Node-only options (fatal-handler modes, header/body redaction
     * config, shutdown timeout) into the active configuration. Safe to call
     * before or after `light()`:
     *
     * - Before `light()`: options are stored; listeners are attached when
     *   `light()` runs.
     * - After `light()`: options are stored AND listeners are reconciled
     *   immediately, so flipping a mode to `'off'` detaches the handler and
     *   flipping it back to `'report'`/`'report-and-exit'` re-attaches.
     *
     * Regex options (`headerAllowlist`, `bodyAllowedContentTypes`,
     * `bodyKeyDenylist`) are passed through `sanitizeRegex` to strip stateful
     * `g`/`y` flags; without that, `RegExp.prototype.test` would skip matches
     * across keys.
     */
    configureNode(partial: Partial<NodeOptions>): NodeFlare {
        if (partial.headerDenylist !== undefined || partial.replaceDefaultHeaderDenylist !== undefined) {
            this.nodeOptions.headerDenylist = resolveHeaderDenylist(
                partial.headerDenylist ?? undefined,
                partial.replaceDefaultHeaderDenylist ?? this.nodeOptions.replaceDefaultHeaderDenylist,
            );
            this.nodeOptions.replaceDefaultHeaderDenylist =
                partial.replaceDefaultHeaderDenylist ?? this.nodeOptions.replaceDefaultHeaderDenylist;
        }
        if (partial.headerAllowlist !== undefined) {
            this.nodeOptions.headerAllowlist =
                partial.headerAllowlist === null ? null : sanitizeRegex(partial.headerAllowlist);
        }
        if (partial.uncaughtExceptionMode !== undefined)
            this.nodeOptions.uncaughtExceptionMode = partial.uncaughtExceptionMode;
        if (partial.unhandledRejectionMode !== undefined)
            this.nodeOptions.unhandledRejectionMode = partial.unhandledRejectionMode;
        if (partial.shutdownTimeoutMs !== undefined) this.nodeOptions.shutdownTimeoutMs = partial.shutdownTimeoutMs;
        if (partial.captureRequestBody !== undefined) this.nodeOptions.captureRequestBody = partial.captureRequestBody;
        if (partial.bodyMaxBytes !== undefined) this.nodeOptions.bodyMaxBytes = partial.bodyMaxBytes;
        if (partial.bodyAllowedContentTypes !== undefined)
            this.nodeOptions.bodyAllowedContentTypes = sanitizeRegex(partial.bodyAllowedContentTypes);
        if (partial.bodyKeyDenylist !== undefined)
            this.nodeOptions.bodyKeyDenylist = sanitizeRegex(partial.bodyKeyDenylist);

        if (this.isLit) this.handlerManager.reconcile(this.nodeOptions);
        return this;
    }

    /**
     * Run `fn` inside a fresh `NodeScope` carrying the supplied request
     * metadata. Inside `fn` (and any async work it awaits), `flare.glow(...)`,
     * `flare.addContext(...)`, `flare.setUser(...)`, and `flare.report(...)`
     * see a scope that is isolated from other concurrent requests.
     *
     * Mirrors a typical web-framework middleware: call once per request,
     * wrapping the request handler, and the SDK will attribute any error
     * reported inside the chain to the right request.
     */
    runWithContext<T>(request: RequestContext, fn: () => T): T {
        return this.nodeScopeProvider.runWithContext(request, fn);
    }

    /**
     * Patch the request metadata on the active scope after `runWithContext(...)`
     * has already started. Useful when fields become known partway through a
     * request (e.g., the resolved absolute URL after proxy headers are parsed).
     *
     * Outside any `runWithContext(...)` callback, this writes to the fallback
     * scope; the patch is visible to subsequent reports issued from outside a
     * request scope but is NOT inherited by future `runWithContext(...)` calls.
     */
    mergeContext(partial: Partial<RequestContext>): void {
        this.nodeScopeProvider.mergeContext(partial);
    }

    /**
     * Attach an authenticated user to the active scope. Inside a request scope
     * this is per-request; outside it lands on the fallback scope. The fields
     * are projected to OTel-style keys (`enduser.id`, `enduser.email`,
     * `enduser.username`, `client.address`) by the Node context collector.
     */
    setUser(user: User | null): void {
        this.nodeScopeProvider.setUser(user);
    }

    /**
     * Returns the request scope when called inside `runWithContext(...)`, or
     * `null` outside. Intentionally returns `null` (not the fallback scope)
     * when no request is active, so callers can distinguish "we are inside a
     * request" from "we are not". Primarily useful for debugging.
     */
    getContext(): NodeScope | null {
        return this.nodeScopeProvider.getContext();
    }

    /**
     * Detach the `uncaughtException` and `unhandledRejection` listeners
     * without changing `nodeOptions`. Intended for tests and for graceful
     * shutdown paths where you want to take ownership of process exit
     * yourself.
     *
     * Calling `light()` afterwards re-attaches based on the current options.
     */
    removeProcessListeners(): void {
        this.handlerManager.detach();
    }
}
