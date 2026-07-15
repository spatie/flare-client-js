import { vi } from 'vitest';

type Listener = (...args: unknown[]) => void;

/**
 * Fake Electron `App`. `on`/`off` default to a working push/filter event emitter (the resulting
 * `handlers` map is exposed for scheduler-style assertions); app-metadata methods default to
 * ready/non-packaged values and can be overridden per call site.
 */
export function fakeApp(
    overrides: {
        getName?: () => string;
        getVersion?: () => string;
        getLocale?: () => string;
        isReady?: () => boolean;
        isPackaged?: boolean;
    } = {},
) {
    const handlers: Record<string, Listener[]> = {};
    return {
        handlers,
        getName: overrides.getName ?? (() => 'TestApp'),
        getVersion: overrides.getVersion ?? (() => '1.0.0'),
        getLocale: overrides.getLocale ?? (() => 'en-US'),
        isReady: overrides.isReady ?? (() => true),
        isPackaged: overrides.isPackaged ?? false,
        on: vi.fn((event: string, cb: Listener) => {
            (handlers[event] ??= []).push(cb);
        }),
        off: vi.fn((event: string, cb: Listener) => {
            handlers[event] = (handlers[event] ?? []).filter((h) => h !== cb);
        }),
    };
}

/** Fake Electron `IpcMain`. Throws on a double `handle()` for the same channel without an intervening `removeHandler()`. */
export function fakeIpcMain() {
    const handlers: Record<string, Function> = {};
    return {
        handlers,
        handle: vi.fn((channel: string, fn: Function) => {
            if (handlers[channel]) throw new Error('Attempted to register a second handler');
            handlers[channel] = fn;
        }),
        removeHandler: vi.fn((channel: string) => {
            delete handlers[channel];
        }),
    };
}
