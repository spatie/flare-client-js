import { describe, expect, it } from 'vitest';

import { makeElectronContextCollector, collectElectronAppAttributes } from '../src/main/collectElectron';
import type { ElectronUser } from '../src/types';

function fakeApp(isReady: boolean) {
    return {
        getName: () => 'TestApp',
        getVersion: () => '9.9.9',
        getLocale: () => {
            if (!isReady) throw new Error('getLocale called before ready');
            return 'en-US';
        },
        isReady: () => isReady,
        isPackaged: true,
    };
}

const cfg = {} as any;

describe('electron context collector', () => {
    it('projects app + runtime attributes', () => {
        const attrs = collectElectronAppAttributes(fakeApp(true) as any);
        expect(attrs['service.name']).toBe('TestApp');
        expect(attrs['app.version']).toBe('9.9.9');
        expect(attrs['app.locale']).toBe('en-US');
        expect(attrs['app.packaged']).toBe(true);
        expect(attrs['process.runtime.name']).toBe('electron');
        // per-process fields must NOT be present; they belong only on main-origin reports
        expect(attrs['flare.entry_point.type']).toBeUndefined();
        expect(attrs['process.type']).toBeUndefined();
        expect(typeof attrs['process.versions.electron']).toBe('string');
    });

    it('omits locale (no throw) before app is ready', () => {
        const attrs = collectElectronAppAttributes(fakeApp(false) as any);
        expect(attrs['app.locale']).toBeUndefined();
        expect(attrs['service.name']).toBe('TestApp');
    });

    it('collector adds per-process fields for main-origin reports', () => {
        const collector = makeElectronContextCollector(fakeApp(true) as any, () => null);
        const attrs = collector(cfg);
        expect(attrs['flare.entry_point.type']).toBe('server');
        expect(typeof attrs['process.type']).toBe('string');
        expect(attrs['service.name']).toBe('TestApp');
        expect(attrs['process.runtime.name']).toBe('electron');
    });

    it('projects the current user via the getter', () => {
        let user: ElectronUser | null = null;
        const collector = makeElectronContextCollector(fakeApp(true) as any, () => user);
        expect(collector(cfg)['enduser.id']).toBeUndefined();
        user = { id: 42, email: 'a@b.co', username: 'amy', ipAddress: '1.2.3.4' };
        const attrs = collector(cfg);
        expect(attrs['enduser.id']).toBe('42');
        expect(attrs['enduser.email']).toBe('a@b.co');
        expect(attrs['enduser.username']).toBe('amy');
        expect(attrs['client.address']).toBe('1.2.3.4');
    });
});
