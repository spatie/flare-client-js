import type { Config } from '@flareapp/core';

// Module-global, set once from the browser Flare constructor. The instrumentation needs the ingest
// URLs to know which requests are Flare's own, and the debug flag for its own warnings. It reads
// nothing else, and never writes. Multi-instance behaviour is unchanged: the last constructed client
// wins, exactly as the tracing globals already behave.
let read: (() => Config) | null = null;

export function setInstrumentationConfig(getConfig: () => Config): void {
    read = getConfig;
}

export function instrumentationConfig(): Config | null {
    return read ? read() : null;
}
