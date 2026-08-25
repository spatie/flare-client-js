import type { Attributes, Config } from '@flareapp/core';

// `config` is a function so a `configure()` call reaches the recorders without a re-install.
export type BreadcrumbHost = {
    config(): Config;
    record(type: string, attributes: Attributes, startTimeUnixNano: number): void;
};

export type BreadcrumbRecorder = {
    readonly type: string;
    /** @returns the teardown for this recorder */
    install(): () => void;
};
