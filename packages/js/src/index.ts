import { catchWindowErrors } from './browser';
import { Flare } from './Flare';

export const flare = new Flare();

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { Flare } from './Flare';
export { convertToError, DEFAULT_URL_DENYLIST, redactFullPath, resolveDenylist } from './util';
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
