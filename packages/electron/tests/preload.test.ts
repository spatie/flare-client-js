import { describe, expect, it, vi } from 'vitest';

const exposed: Record<string, any> = {};
const invoke = vi.fn().mockResolvedValue(undefined);

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld: (key: string, api: any) => {
            exposed[key] = api;
        },
    },
    ipcRenderer: { invoke: (...args: any[]) => invoke(...args) },
}));

describe('exposeFlare', () => {
    it('exposes __flare.report that invokes the flare:report channel with the payload string', async () => {
        const { exposeFlare } = await import('../src/preload');
        exposeFlare();
        expect(typeof exposed['__flare'].report).toBe('function');
        await exposed['__flare'].report('{"some":"json"}');
        expect(invoke).toHaveBeenCalledWith('flare:report', '{"some":"json"}');
    });
});
