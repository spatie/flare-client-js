import { app, ipcMain } from 'electron';

import { ElectronFlare } from './main/ElectronFlare';

export const flare = new ElectronFlare({ app, ipcMain });

export { ElectronFlare } from './main/ElectronFlare';
export type { ElectronOptions, ElectronUser, ElectronFatalMode, SenderFrame } from './types';
export { FLARE_IPC_CHANNEL, FLARE_BRIDGE_KEY } from './constants';

// Re-export the core surface consumers commonly need.
export {
    Logger,
    Scope,
    GlobalScopeProvider,
    NullFileReader,
    convertToError,
    DEFAULT_URL_DENYLIST,
    redactUrlQuery,
    resolveDenylist,
} from '@flareapp/core';
export type {
    Attributes,
    AttributeValue,
    Config,
    Glow,
    MessageLevel,
    Report,
    SdkInfo,
    StackFrame,
} from '@flareapp/core';
