import type { Attributes, Config } from '@flareapp/core';

/**
 * What every recorder needs. `config` is a function, so a `configure()` call reaches the recorders
 * without a re-install.
 */
export type BreadcrumbHost = {
    config(): Config;
    record(type: string, attributes: Attributes, startTimeUnixNano: number): void;
};

/**
 * One recorder per kind of breadcrumb. No base class: with a handful of recorders and no per-recorder
 * settings, a base class would hold one method. `FileReader` and `FlushScheduler` use this same shape.
 */
export type BreadcrumbRecorder = {
    readonly type: string;
    /** @returns the teardown for this recorder */
    install(): () => void;
};
