// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    addRequestSettleHandler,
    resetRequestInstrumentationForTests,
    setRequestStartHandler,
} from '../src/instrument/request';
import { recordSettles, useInstrumentationConfig } from './helpers';

// Registration is the handle on the patch: the first handler installs it, the last unsubscribe takes
// it off again. Install and uninstall are deliberately private to the module.
describe('the XMLHttpRequest.prototype patch', () => {
    beforeEach(() => {
        useInstrumentationConfig();
    });

    afterEach(() => {
        resetRequestInstrumentationForTests();
    });

    it('patches open/send/setRequestHeader and restores them', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const nativeSend = proto.send;

        const stop = addRequestSettleHandler(() => {});
        expect(proto.send).not.toBe(nativeSend);
        expect((proto.send as { __flare_original__?: unknown }).__flare_original__).toBe(nativeSend);
        expect((proto.open as { __flare_original__?: unknown }).__flare_original__).toBeDefined();
        expect((proto.setRequestHeader as { __flare_original__?: unknown }).__flare_original__).toBeDefined();

        stop();
        expect(proto.send).toBe(nativeSend);
    });

    it('is idempotent (a second handler does not stack a wrapper)', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, unknown>;

        addRequestSettleHandler(() => {});
        const firstSend = proto.send;
        addRequestSettleHandler(() => {});
        expect(proto.send).toBe(firstSend);
    });

    it('open without send reports nothing (reused instance stays inert until send)', () => {
        const { entries } = recordSettles();

        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://app.example/one');
        // open again reuses the instance; still no send() -> still nothing to report.
        xhr.open('GET', 'https://app.example/two');
        expect(entries).toHaveLength(0);
    });

    it('a third party wrapping send leaves the other two patched methods restorable', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        // The start owner is asked synchronously inside send(), so it counts how many of our send
        // wrappers a request went through. A settle would only arrive at DONE, long after this test.
        const owner = vi.fn(() => null);

        const stopStart = setRequestStartHandler(owner);
        const flareSend = proto.send;

        // A third party wraps `send` on top of Flare's wrapper, so the last unsubscribe cannot restore it.
        const thirdParty = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
            return (flareSend as unknown as (...a: unknown[]) => unknown).apply(this, args);
        };
        proto.send = thirdParty as unknown as { __flare_original__?: unknown };

        stopStart();
        expect(proto.send).toBe(thirdParty); // the leak is real

        setRequestStartHandler(owner); // re-registering must not permanently wedge `open`

        // (a) open is still Flare's wrapper -> the instrumentation is not permanently dead.
        expect((proto.open as { __flare_original__?: unknown }).__flare_original__).toBeDefined();

        // (b) one request through open() -> send() asks the owner exactly once, so re-registering did
        // not stack a second `send` wrapper under the leaked third party.
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://app.example/one');
        xhr.send();
        expect(owner).toHaveBeenCalledTimes(1);

        // Unwind the third party so the afterEach reset can fully restore the natives.
        proto.send = flareSend;
    });

    it('restores the prototype it patched even after XMLHttpRequest is replaced', () => {
        const realXHR = globalThis.XMLHttpRequest;
        const proto = realXHR.prototype as unknown as Record<string, unknown>;
        const nativeSend = proto.send;

        const stop = addRequestSettleHandler(() => {});
        expect(proto.send).not.toBe(nativeSend);

        // A polyfill or test harness swaps the constructor after we installed.
        class ReplacementXHR {
            open(): void {}
            setRequestHeader(): void {}
            send(): void {}
        }
        globalThis.XMLHttpRequest = ReplacementXHR as unknown as typeof XMLHttpRequest;

        try {
            stop();
            expect(proto.send).toBe(nativeSend);

            addRequestSettleHandler(() => {});
            expect(
                (ReplacementXHR.prototype.send as unknown as { __flare_original__?: unknown }).__flare_original__,
            ).toBeDefined();
        } finally {
            resetRequestInstrumentationForTests();
            globalThis.XMLHttpRequest = realXHR;
        }
    });
});
