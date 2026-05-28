import { Flare } from '@flareapp/core';

import { catchWindowErrors } from './browser';

export const flare = new Flare();

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { Flare } from '@flareapp/core';
export { convertToError, DEFAULT_URL_DENYLIST, redactUrlQuery, resolveDenylist } from '@flareapp/core';
export { redactUrlQuery as redactFullPath } from '@flareapp/core';
export type {
    AttributeValue,
    Attributes,
    Config,
    EntryPointHandler,
    Framework,
    Glow,
    MessageLevel,
    OverriddenGrouping,
    Report,
    SdkInfo,
    SpanEvent,
    StackFrame,
} from './types';
