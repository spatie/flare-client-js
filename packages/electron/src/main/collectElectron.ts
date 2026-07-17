import os from 'node:os';

import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import type { App } from 'electron';

type AppLike = Pick<App, 'getName' | 'getVersion' | 'getLocale' | 'isReady'> & { isPackaged: boolean };

/**
 * App + runtime attributes safe to overlay onto any report regardless of origin. Reused by both
 * the collector (main errors) and the IPC receiver (forwarded renderer reports). Excludes per-process
 * fields like `flare.entry_point.type` / `process.type` so forwarded renderer reports keep their own.
 */
export function collectElectronAppAttributes(app: AppLike): Attributes {
    const versions = process.versions as Record<string, string | undefined>;
    const attrs: Attributes = {
        'service.name': app.getName(),
        'app.version': app.getVersion(),
        'app.packaged': app.isPackaged,
        'process.runtime.name': 'electron',
        'process.runtime.version': versions.electron ?? '',
        'process.versions.electron': versions.electron ?? '',
        'process.versions.chrome': versions.chrome ?? '',
        'process.versions.node': versions.node ?? process.version,
        'host.arch': process.arch,
        'os.type': os.type(),
    };

    // getLocale() is only reliable after the 'ready' event. Omit it pre-ready rather than throw.
    if (app.isReady()) {
        try {
            attrs['app.locale'] = app.getLocale();
        } catch {
            // locale stays unset
        }
    }

    return attrs;
}

/** Build the ContextCollector core calls on every main-process report. */
export function makeElectronContextCollector(app: AppLike): ContextCollector {
    return (_config: Readonly<Config>): Attributes => ({
        // Per-process fields reflect the main process; applied only to main-origin reports, not
        // forwarded renderer reports (which carry their own entry_point.type).
        'flare.entry_point.type': 'server',
        'process.type': (process as { type?: string }).type ?? 'browser',
        ...collectElectronAppAttributes(app),
    });
}
