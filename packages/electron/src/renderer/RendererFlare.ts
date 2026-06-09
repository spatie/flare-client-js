import { flatJsonStringify, type Config, type Report } from '@flareapp/core';
import { Flare as BrowserFlare } from '@flareapp/js/browser';

import { FLARE_BRIDGE_KEY } from '../constants';
import { CLIENT_VERSION } from '../env';

type BridgeApi = { report: (payload: string) => unknown };

export type RendererFlareOptions = {
    /** Max serialized report size in bytes; oversized reports are dropped with a warning. */
    maxReportBytes?: number;
};

export class RendererFlare extends BrowserFlare {
    private maxReportBytes: number;
    private rendererBeforeSubmit: (report: Report) => Report | false | null | Promise<Report | false | null> = (r) => r;
    private warnedNoBridge = false;

    constructor(options: RendererFlareOptions = {}) {
        super();
        this.maxReportBytes = options.maxReportBytes ?? 1_000_000;
        this.setSdkInfo({ name: '@flareapp/electron', version: CLIENT_VERSION });
    }

    configure(config: Partial<Config>): this {
        if (config.beforeSubmit !== undefined) this.rendererBeforeSubmit = config.beforeSubmit;
        return super.configure(config);
    }

    /**
     * Renderer transport. Core's sendReport short-circuits without an API key, so we override it
     * entirely: scrub, serialize cycle-safely, size-check, then forward a STRING over the bridge.
     */
    async sendReport(report: Report): Promise<void> {
        const scrubbed = await this.rendererBeforeSubmit(report);
        if (!scrubbed) return;

        const payload = flatJsonStringify(scrubbed);
        if (byteLength(payload) > this.maxReportBytes) {
            console.warn('[flare] Renderer report exceeds maxReportBytes; dropping.');
            return;
        }

        const bridge = (globalThis as unknown as Record<string, BridgeApi | undefined>)[FLARE_BRIDGE_KEY];
        if (!bridge) {
            if (!this.warnedNoBridge) {
                this.warnedNoBridge = true;
                console.warn(
                    '[flare] window.__flare is not available. Did you call exposeFlare() in your preload script?',
                );
            }
            return;
        }
        await bridge.report(payload);
    }
}

function byteLength(s: string): number {
    return new TextEncoder().encode(s).length;
}
