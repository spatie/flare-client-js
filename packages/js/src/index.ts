import { Flare } from './Flare';
import { catchWindowErrors } from './browser';

export const flare = new Flare();

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error attach to window
    window.flare = flare;
    catchWindowErrors();
}

export { Flare } from './Flare';
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
