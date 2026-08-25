// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { instrumentXHR, unpatchXHR } from '../src/instrumentation/requests';
import { resetRequestBus } from '../src/instrumentation/requests';
import { traceRequests } from '../src/tracing/traceRequests';
import { fixedUrls, makeTracer } from './helpers';

const URLS = fixedUrls('https://app.example');

describe('instrumentXHR / unpatchXHR on XMLHttpRequest.prototype', () => {
    beforeEach(() => resetRequestBus());
    afterEach(() => unpatchXHR());

    it('patches open/send/setRequestHeader and restores them', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const nativeSend = proto.send;
        const { tracer } = makeTracer();

        traceRequests(tracer, URLS);
        instrumentXHR();
        expect(proto.send).not.toBe(nativeSend);
        expect((proto.send as { __flare_original__?: unknown }).__flare_original__).toBe(nativeSend);
        expect((proto.open as { __flare_original__?: unknown }).__flare_original__).toBeDefined();
        expect((proto.setRequestHeader as { __flare_original__?: unknown }).__flare_original__).toBeDefined();

        unpatchXHR();
        expect(proto.send).toBe(nativeSend);
    });

    it('is idempotent (a second instrumentXHR does not stack a wrapper)', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, unknown>;
        const { tracer } = makeTracer();

        traceRequests(tracer, URLS);
        instrumentXHR();
        const firstSend = proto.send;
        instrumentXHR();
        expect(proto.send).toBe(firstSend);
    });

    it('open without send creates no span (reused instance stays inert until send)', () => {
        const { tracer, startSpan } = makeTracer();
        traceRequests(tracer, URLS);
        instrumentXHR();

        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://app.example/one');
        // open again reuses the instance; still no send() -> still no span.
        xhr.open('GET', 'https://app.example/two');
        expect(startSpan).not.toHaveBeenCalled();
    });

    it('a third party wrapping send leaves the other two patched methods restorable', () => {
        const proto = XMLHttpRequest.prototype as unknown as Record<string, { __flare_original__?: unknown }>;
        const { tracer, startSpan } = makeTracer();

        traceRequests(tracer, URLS);
        instrumentXHR();
        const flareSend = proto.send;

        // A third party wraps `send` on top of Flare's wrapper, so unpatchXHR cannot restore it.
        const thirdParty = function (this: XMLHttpRequest, ...args: unknown[]): unknown {
            return (flareSend as unknown as (...a: unknown[]) => unknown).apply(this, args);
        };
        proto.send = thirdParty as unknown as { __flare_original__?: unknown };

        unpatchXHR();
        expect(proto.send).toBe(thirdParty); // the leak is real

        instrumentXHR(); // re-enable must not permanently wedge `open`

        // (a) open is still Flare's wrapper -> tracing is not permanently dead.
        expect((proto.open as { __flare_original__?: unknown }).__flare_original__).toBeDefined();

        // (b) one traced request through open() -> send() creates exactly one span, so
        // re-instrumenting did not stack a second `send` wrapper under the leaked third party.
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'https://app.example/one');
        xhr.send();
        expect(startSpan).toHaveBeenCalledTimes(1);

        // Unwind the third party so afterEach's unpatchXHR can fully restore natives.
        proto.send = flareSend;
    });

    it('restores the prototype it patched even after XMLHttpRequest is replaced', () => {
        const realXHR = globalThis.XMLHttpRequest;
        const proto = realXHR.prototype as unknown as Record<string, unknown>;
        const nativeSend = proto.send;
        const { tracer } = makeTracer();

        traceRequests(tracer, URLS);
        instrumentXHR();
        expect(proto.send).not.toBe(nativeSend);

        // A polyfill or test harness swaps the constructor after we installed.
        class ReplacementXHR {
            open(): void {}
            setRequestHeader(): void {}
            send(): void {}
        }
        globalThis.XMLHttpRequest = ReplacementXHR as unknown as typeof XMLHttpRequest;

        try {
            unpatchXHR();
            expect(proto.send).toBe(nativeSend);

            instrumentXHR();
            expect(
                (ReplacementXHR.prototype.send as unknown as { __flare_original__?: unknown }).__flare_original__,
            ).toBeDefined();
        } finally {
            unpatchXHR();
            globalThis.XMLHttpRequest = realXHR;
        }
    });
});
