import { contextBridge, ipcRenderer } from 'electron';

import { FLARE_BRIDGE_KEY, FLARE_IPC_CHANNEL } from './constants';

/**
 * Call once in your preload script. Bridges renderer error reports to the main process over a
 * single contextBridge method. Respects contextIsolation; does not require nodeIntegration.
 */
export function exposeFlare(): void {
    contextBridge.exposeInMainWorld(FLARE_BRIDGE_KEY, {
        report: (payload: string) => ipcRenderer.invoke(FLARE_IPC_CHANNEL, payload),
    });
}
