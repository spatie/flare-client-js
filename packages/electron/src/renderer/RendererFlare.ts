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
    private noBridgeCount = 0;
    private oversizedCount = 0;
    private sendFailedCount = 0;

    constructor(options: RendererFlareOptions = {}) {
        super();
        this.maxReportBytes = options.maxReportBytes ?? 1_000_000;
        this.setSdkInfo({ name: '@flareapp/electron', version: CLIENT_VERSION });
    }

    configure(config: Partial<Config>): this {
        if (config.beforeSubmit !== undefined) {
            this.rendererBeforeSubmit = config.beforeSubmit;
        }
        return super.configure(config);
    }

    /**
     * Renderer transport. Core's sendReport short-circuits without an API key, so we override it
     * entirely: scrub, serialize cycle-safely, size-check, then forward a STRING over the bridge.
     */
    async sendReport(report: Report): Promise<void> {
        const scrubbed = await this.rendererBeforeSubmit(report);
        if (!scrubbed) {
            return;
        }

        const payload = flatJsonStringify(scrubbed);
        if (byteLength(payload) > this.maxReportBytes) {
            this.oversizedCount += 1;
            if (shouldWarn(this.oversizedCount)) {
                console.warn(
                    `[flare] Renderer report exceeds maxReportBytes; dropping. (count: ${this.oversizedCount})`,
                );
            }
            return;
        }

        const bridge = (globalThis as unknown as Record<string, BridgeApi | undefined>)[FLARE_BRIDGE_KEY];
        if (!bridge) {
            this.noBridgeCount += 1;
            if (shouldWarn(this.noBridgeCount)) {
                console.warn(
                    `[flare] window.__flare is not available. Did you call exposeFlare() in your preload script? (count: ${this.noBridgeCount})`,
                );
            }
            return;
        }
        try {
            await bridge.report(payload);
        } catch (error) {
            this.sendFailedCount += 1;
            if (shouldWarn(this.sendFailedCount)) {
                console.warn(
                    `[flare] Failed to forward a report to the main process. (count: ${this.sendFailedCount})`,
                    error,
                );
            }
        }
    }
}

function byteLength(s: string): number {
    return new TextEncoder().encode(s).length;
}

// Warn on 1, 10, 100, 1000, ... — first occurrence plus each power-of-ten milestone.
// Integer-only check; avoids the float precision pitfalls of Math.log10 on powers of ten.
function shouldWarn(count: number): boolean {
    if (count < 1) {
        return false;
    }
    let n = count;
    while (n > 1) {
        if (n % 10 !== 0) {
            return false;
        }
        n /= 10;
    }
    return n === 1;
}
