export type RequestContext = {
    method?: string;
    path?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
};

export type User = {
    id?: string | number;
    email?: string;
    username?: string;
    ipAddress?: string;
};

export type FatalMode = 'off' | 'report' | 'report-and-exit';

export type NodeOptions = {
    uncaughtExceptionMode?: FatalMode;
    unhandledRejectionMode?: FatalMode;
    shutdownTimeoutMs?: number;
    headerDenylist?: RegExp;
    headerAllowlist?: RegExp | null;
    replaceDefaultHeaderDenylist?: boolean;
    captureRequestBody?: boolean;
    bodyMaxBytes?: number;
    bodyAllowedContentTypes?: RegExp;
    bodyKeyDenylist?: RegExp;
};

export type ResolvedNodeOptions = Required<
    Omit<NodeOptions, 'headerDenylist' | 'headerAllowlist' | 'bodyKeyDenylist'>
> & {
    headerDenylist: RegExp;
    headerAllowlist: RegExp | null;
    bodyKeyDenylist: RegExp;
};
