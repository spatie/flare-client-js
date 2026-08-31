import { Api, Flare as CoreFlare, FrameworkName } from '@flareapp/core';

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

// `g`/`y` make `.test()` keep `lastIndex` state, so reusing the regex across keys skips every other
// match. All other flags are preserved.
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
 * Node.js `Flare` singleton, exported from `@flareapp/node` as `flare`.
 *
 * Subclasses core's `Flare` and wires the Node-only seams: per-request scope via
 * `AsyncLocalStorageScopeProvider`, a Node context collector, `DiskFileReader` for stack snippets,
 * and `ProcessHandlerManager` for the fatal listeners. Adds `configureNode`, `runWithContext`,
 * `mergeContext`, `getContext`, and `removeProcessListeners` on top of the core API.
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
        // Claim 'node' so a bare Node app is never framework-less on the wire. A host framework
        // integration calls setFramework later with its own name, which overwrites this.
        this.setFramework({ name: FrameworkName.Node });

        const cbs = buildFatalCallbacks(this, () => this.nodeOptions);
        this.handlerManager = new ProcessHandlerManager(cbs);
    }

    /** Reconcile runs on every call, so `light()` re-attaches after `removeProcessListeners()`. */
    light(key?: string, debug?: boolean) {
        super.light(key, debug);
        this.isLit = true;
        this.handlerManager.reconcile(this.nodeOptions);
        return this;
    }

    /**
     * Safe before or after `light()`. Before, the listeners attach on `light()`; after, they reconcile
     * immediately, so flipping a mode to `'off'` detaches and flipping it back re-attaches.
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
     * Use as web-framework middleware, once per request around the handler. Inside `fn` and any async
     * work it awaits, reports are attributed to that request rather than to a concurrent one.
     */
    runWithContext<T>(request: RequestContext, fn: () => T): T {
        return this.nodeScopeProvider.runWithContext(request, fn);
    }

    /**
     * For fields that only become known partway through a request, such as the absolute URL once proxy
     * headers are parsed. Outside `runWithContext(...)` this writes to the fallback scope, which future
     * `runWithContext(...)` calls do not inherit.
     */
    mergeContext(partial: Partial<RequestContext>): void {
        this.nodeScopeProvider.mergeContext(partial);
    }

    /** Null (not the fallback scope) outside a request, so callers can tell the two apart. Debugging aid. */
    getContext(): NodeScope | null {
        return this.nodeScopeProvider.getContext();
    }

    /** Leaves `nodeOptions` alone, so a later `light()` re-attaches. For tests and graceful shutdown. */
    removeProcessListeners(): void {
        this.handlerManager.detach();
    }
}
