import { Api, Flare as CoreFlare } from '@flareapp/core';

import { DEFAULT_BODY_CONTENT_TYPES, DEFAULT_BODY_KEY_DENYLIST } from './context/body';
import { makeNodeContextCollector } from './context/collectNode';
import { DEFAULT_HEADER_DENYLIST, resolveHeaderDenylist } from './context/headers';
import { NodeFlushScheduler } from './logging/NodeFlushScheduler';
import { buildFatalCallbacks } from './process/fatal';
import { ProcessHandlerManager } from './process/handlers';
import { AsyncLocalStorageScopeProvider } from './scope/AsyncLocalStorageScopeProvider';
import type { NodeScope } from './scope/NodeScope';
import { DiskFileReader } from './stacktrace/DiskFileReader';
import type { NodeOptions, RequestContext, ResolvedNodeOptions } from './types';

const NODE_SDK_NAME = '@flareapp/node';
const NODE_SDK_VERSION =
    typeof process !== 'undefined' && process.env?.FLARE_JS_CLIENT_VERSION !== undefined
        ? process.env.FLARE_JS_CLIENT_VERSION
        : '?';

/**
 * Strip `g`/`y` flags from a user-supplied regex. Those flags make `.test()`/`.exec()` keep
 * `lastIndex` state, so reusing the regex across keys (header denylist, body redaction) skips matches
 * after the first hit. All other flags and the source are preserved.
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
 * - `AsyncLocalStorageScopeProvider` so each `runWithContext(...)` callback gets its own `NodeScope`,
 *   isolated from concurrent requests.
 * - `makeNodeContextCollector(...)` projects the current `NodeScope` + process info into report attrs.
 * - `DiskFileReader` reads source for stack-trace snippets via `node:fs/promises`, not `fetch`.
 * - `ProcessHandlerManager` attaches/detaches the fatal process listeners per `NodeOptions`.
 *
 * Adds Node-only API on top of core: `configureNode`, `runWithContext`, `mergeContext`, `getContext`,
 * `removeProcessListeners`. Inherited core methods return `this`, so chaining keeps the `NodeFlare`
 * type and `configureNode(...)` stays callable mid-chain.
 */
export class NodeFlare extends CoreFlare {
    private nodeOptions: ResolvedNodeOptions = { ...DEFAULT_NODE_OPTIONS };
    private isLit = false;
    private nodeScopeProvider: AsyncLocalStorageScopeProvider;
    private handlerManager: ProcessHandlerManager;

    constructor() {
        const scopeProvider = new AsyncLocalStorageScopeProvider();
        // Collector closes over a getter (`() => this.nodeOptions`), not a value, so later
        // `configureNode(...)` calls affect future reports without reinjecting the collector.
        const collector = makeNodeContextCollector(scopeProvider, () => this.nodeOptions);
        super(new Api(), collector, new DiskFileReader(), scopeProvider, new NodeFlushScheduler());
        this.nodeScopeProvider = scopeProvider;
        this.setSdkInfo({ name: NODE_SDK_NAME, version: NODE_SDK_VERSION });

        const cbs = buildFatalCallbacks(this, () => this.nodeOptions);
        this.handlerManager = new ProcessHandlerManager(cbs);
    }

    /**
     * Set the API key (and optional debug flag), then reconcile process listeners with the current
     * `nodeOptions`. Reconcile runs on every call, so `light()` re-attaches after
     * `removeProcessListeners()`.
     */
    light(key?: string, debug?: boolean) {
        super.light(key, debug);
        this.isLit = true;
        this.handlerManager.reconcile(this.nodeOptions);
        return this;
    }

    /**
     * Merge Node-only options (fatal-handler modes, header/body redaction, shutdown timeout) into the
     * active config. Safe before or after `light()`: before, options are stored and listeners attach on
     * `light()`; after, options are stored and listeners reconcile immediately (flipping a mode to
     * `'off'` detaches, back to `'report'`/`'report-and-exit'` re-attaches).
     *
     * Regex options are run through `sanitizeRegex` to strip stateful `g`/`y` flags.
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

        if (partial.uncaughtExceptionMode !== undefined) {
            this.nodeOptions.uncaughtExceptionMode = partial.uncaughtExceptionMode;
        }

        if (partial.unhandledRejectionMode !== undefined) {
            this.nodeOptions.unhandledRejectionMode = partial.unhandledRejectionMode;
        }

        if (partial.shutdownTimeoutMs !== undefined) {
            this.nodeOptions.shutdownTimeoutMs = partial.shutdownTimeoutMs;
        }

        if (partial.captureRequestBody !== undefined) {
            this.nodeOptions.captureRequestBody = partial.captureRequestBody;
        }

        if (partial.bodyMaxBytes !== undefined) {
            this.nodeOptions.bodyMaxBytes = partial.bodyMaxBytes;
        }

        if (partial.bodyAllowedContentTypes !== undefined) {
            this.nodeOptions.bodyAllowedContentTypes = sanitizeRegex(partial.bodyAllowedContentTypes);
        }

        if (partial.bodyKeyDenylist !== undefined) {
            this.nodeOptions.bodyKeyDenylist = sanitizeRegex(partial.bodyKeyDenylist);
        }

        if (this.isLit) {
            this.handlerManager.reconcile(this.nodeOptions);
        }

        return this;
    }

    /**
     * Run `fn` inside a fresh `NodeScope` carrying the supplied request metadata. Inside `fn` and any
     * async work it awaits, glow/addContext/setUser/report see a scope isolated from concurrent
     * requests. Use as web-framework middleware: call once per request wrapping the handler, and reports
     * are attributed to the right request.
     */
    runWithContext<T>(request: RequestContext, fn: () => T): T {
        return this.nodeScopeProvider.runWithContext(request, fn);
    }

    /**
     * Patch request metadata on the active scope after `runWithContext(...)` started. Useful when fields
     * become known partway through a request (e.g. the absolute URL after proxy headers are parsed).
     *
     * Outside any `runWithContext(...)`, writes to the fallback scope: visible to later outside-scope
     * reports but not inherited by future `runWithContext(...)` calls.
     */
    mergeContext(partial: Partial<RequestContext>): void {
        this.nodeScopeProvider.mergeContext(partial);
    }

    /**
     * Request scope inside `runWithContext(...)`, or `null` outside. Returns `null` (not the fallback
     * scope) so callers can tell "inside a request" from "not". Mainly for debugging.
     */
    getContext(): NodeScope | null {
        return this.nodeScopeProvider.getContext();
    }

    /**
     * Detach the fatal process listeners without changing `nodeOptions`. For tests and graceful-shutdown
     * paths that own process exit. `light()` afterwards re-attaches per the current options.
     */
    removeProcessListeners(): void {
        this.handlerManager.detach();
    }
}
