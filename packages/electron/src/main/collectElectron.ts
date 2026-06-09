import os from 'node:os';

import type { Attributes, Config, ContextCollector } from '@flareapp/core';
import type { App } from 'electron';

import type { ElectronUser } from '../types';

type AppLike = Pick<App, 'getName' | 'getVersion' | 'getLocale' | 'isReady'> & { isPackaged: boolean };

/** App + runtime attributes. Reused by both the collector (main errors) and the IPC receiver (forwarded reports). */
export function collectElectronAppAttributes(app: AppLike): Attributes {
    const versions = process.versions as Record<string, string | undefined>;
    const attrs: Attributes = {
        'flare.entry_point.type': 'server',
        'service.name': app.getName(),
        'app.version': app.getVersion(),
        'app.packaged': app.isPackaged,
        'process.type': (process as { type?: string }).type ?? 'browser',
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
            // ignore; locale stays unset
        }
    }

    return attrs;
}

/** Project a user into OTel enduser.* / client.address keys. */
export function projectUser(user: ElectronUser | null): Attributes {
    const attrs: Attributes = {};
    if (!user) return attrs;
    if (user.id !== undefined) attrs['enduser.id'] = String(user.id);
    if (user.email !== undefined) attrs['enduser.email'] = user.email;
    if (user.username !== undefined) attrs['enduser.username'] = user.username;
    if (user.ipAddress !== undefined) attrs['client.address'] = user.ipAddress;
    return attrs;
}

/** Build the ContextCollector core calls on every main-process report. */
export function makeElectronContextCollector(app: AppLike, getUser: () => ElectronUser | null): ContextCollector {
    return (_config: Readonly<Config>): Attributes => ({
        ...collectElectronAppAttributes(app),
        ...projectUser(getUser()),
    });
}
