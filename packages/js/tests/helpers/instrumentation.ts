import type { Config } from '@flareapp/core';

import { setInstrumentationConfig } from '../../src/instrument/config';
import { addRequestSettleHandler, type RequestContext, type RequestResult } from '../../src/instrument/request';

/** Only the keys the request instrumentation and the tracing handlers actually read. */
export function fakeConfig(overrides: Partial<Config> = {}): Config {
    return {
        enableTracing: true,
        ingestUrl: 'https://ingress.flareapp.io/v1/errors',
        logsIngestUrl: 'https://ingress.flareapp.io/v1/logs',
        tracesIngestUrl: 'https://ingress.flareapp.io/v1/traces',
        ...overrides,
    } as unknown as Config;
}

/** Point the module-global instrumentation config at a fake for this test. */
export function useInstrumentationConfig(overrides: Partial<Config> = {}): Config {
    const config = fakeConfig(overrides);
    setInstrumentationConfig(() => config);
    return config;
}

export type SettleEntry = { context: RequestContext; result: RequestResult };

/** Record what the instrumentation reports. Registering also installs the patches. */
export function recordSettles(): { entries: SettleEntry[]; stop: () => void } {
    const entries: SettleEntry[] = [];
    const stop = addRequestSettleHandler((context, result) => entries.push({ context, result }));
    return { entries, stop };
}
