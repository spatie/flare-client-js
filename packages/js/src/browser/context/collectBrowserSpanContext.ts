import type { Attributes, Config, ContextCollector } from '@flareapp/core';

import { browserEntryPoint } from './collectBrowser';
import request from './request';

/**
 * Lean context a browser pageload/navigation root span carries: entry-point plus request identity
 * (url.full, user_agent.original, referrer, ready_state), redacted. Excludes cookies, structured
 * query params (requestData), and host.name (resource-level, sourced separately). Captured at span
 * start so a long-lived root reflects the page it represents, not the page current at close.
 */
export const collectBrowserSpanContext: ContextCollector = (config: Readonly<Config>): Attributes => {
    if (typeof window === 'undefined') {
        return {};
    }
    return { ...browserEntryPoint(config), ...request(config.urlDenylist) };
};
