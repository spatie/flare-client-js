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

export class NodeFlare extends CoreFlare {
    private nodeOptions: ResolvedNodeOptions = { ...DEFAULT_NODE_OPTIONS };
    private isLit = false;
    private nodeScopeProvider: AsyncLocalStorageScopeProvider;
    private handlerManager: ProcessHandlerManager;

    constructor() {
        const scopeProvider = new AsyncLocalStorageScopeProvider();
        const collector = makeNodeContextCollector(scopeProvider, () => this.nodeOptions);
        super(new Api(), collector, new DiskFileReader(), scopeProvider);
        this.nodeScopeProvider = scopeProvider;
        this.setSdkInfo({ name: NODE_SDK_NAME, version: NODE_SDK_VERSION });

        const cbs = buildFatalCallbacks(this, () => this.nodeOptions);
        this.handlerManager = new ProcessHandlerManager(cbs);
    }

    light(key?: string, debug?: boolean) {
        super.light(key, debug);
        this.isLit = true;
        this.handlerManager.reconcile(this.nodeOptions);
        return this;
    }

    configureNode(partial: Partial<NodeOptions>): NodeFlare {
        if (partial.headerDenylist !== undefined || partial.replaceDefaultHeaderDenylist !== undefined) {
            this.nodeOptions.headerDenylist = resolveHeaderDenylist(
                partial.headerDenylist ?? undefined,
                partial.replaceDefaultHeaderDenylist ?? this.nodeOptions.replaceDefaultHeaderDenylist,
            );
            this.nodeOptions.replaceDefaultHeaderDenylist =
                partial.replaceDefaultHeaderDenylist ?? this.nodeOptions.replaceDefaultHeaderDenylist;
        }
        if (partial.headerAllowlist !== undefined) this.nodeOptions.headerAllowlist = partial.headerAllowlist;
        if (partial.uncaughtExceptionMode !== undefined)
            this.nodeOptions.uncaughtExceptionMode = partial.uncaughtExceptionMode;
        if (partial.unhandledRejectionMode !== undefined)
            this.nodeOptions.unhandledRejectionMode = partial.unhandledRejectionMode;
        if (partial.shutdownTimeoutMs !== undefined) this.nodeOptions.shutdownTimeoutMs = partial.shutdownTimeoutMs;
        if (partial.captureRequestBody !== undefined) this.nodeOptions.captureRequestBody = partial.captureRequestBody;
        if (partial.bodyMaxBytes !== undefined) this.nodeOptions.bodyMaxBytes = partial.bodyMaxBytes;
        if (partial.bodyAllowedContentTypes !== undefined)
            this.nodeOptions.bodyAllowedContentTypes = partial.bodyAllowedContentTypes;
        if (partial.bodyKeyDenylist !== undefined) this.nodeOptions.bodyKeyDenylist = partial.bodyKeyDenylist;

        if (this.isLit) this.handlerManager.reconcile(this.nodeOptions);
        return this;
    }

    runWithContext<T>(request: RequestContext, fn: () => T): T {
        return this.nodeScopeProvider.runWithContext(request, fn);
    }

    mergeContext(partial: Partial<RequestContext>): void {
        this.nodeScopeProvider.mergeContext(partial);
    }

    setUser(user: User | null): void {
        this.nodeScopeProvider.setUser(user);
    }

    getContext(): NodeScope | null {
        return this.nodeScopeProvider.getContext();
    }

    removeProcessListeners(): void {
        this.handlerManager.detach();
    }
}
