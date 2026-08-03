import { LogsEnvelope, Report, TracesEnvelope } from '../types';
import { flatJsonStringify } from '../util';
import { utf8Bytes } from '../util/utf8Bytes';

// A browser rejects a keepalive fetch when the sum of its body and every other in-flight keepalive body goes over
// ~64 KiB (Fetch spec). logs and traces share one Api, so on pagehide two ~60 KB envelopes would go over that and one
// of them would be dropped. Track the in-flight total and send a normal (non-keepalive) fetch instead when a request
// would push it over. That request still ships on soft backgrounding, and on a real unload it is no worse off than
// being rejected.
const MAX_PENDING_KEEPALIVE_BYTES = 60_000;
// Second, independent limit: many small keepalive fetches can stay under the byte budget and still exhaust the
// browser's per-page in-flight allowance. 15 leaves room for the host application's own unload requests.
const MAX_PENDING_KEEPALIVE_REQUESTS = 15;

export class Api {
    // Per-Api budget: correct for the single-instance model. Two Flare instances on one page do not share this counter.
    private pendingKeepaliveBytes = 0;
    private pendingKeepaliveRequests = 0;

    report(
        report: Report,
        url: string,
        key: string | null,
        reportBrowserExtensionErrors: boolean,
        debug: boolean = false,
    ): Promise<void> {
        return this.send({
            url,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Api-Token': key ?? '',
                'X-Report-Browser-Extension-Errors': JSON.stringify(reportBrowserExtensionErrors),
                'X-Flare-Client-Version': '2',
            },
            body: flatJsonStringify(report),
            label: 'Flare',
            debug,
            keepalive: false,
        });
    }

    logs(
        envelope: LogsEnvelope,
        url: string,
        key: string | null,
        debug: boolean = false,
        keepalive: boolean = false,
    ): Promise<void> {
        return this.send({
            url,
            headers: this.ingestHeaders(key),
            body: flatJsonStringify(envelope),
            label: 'Flare logs',
            debug,
            keepalive,
        });
    }

    traces(
        envelope: TracesEnvelope,
        url: string,
        key: string | null,
        debug: boolean = false,
        keepalive: boolean = false,
    ): Promise<void> {
        let body: string;
        try {
            // Everything here is attributesToOpenTelemetry output, so safeClone cannot change a byte, unlike
            // report() whose context data is raw. A try that does not throw costs nothing.
            body = JSON.stringify(envelope);
        } catch {
            // status.message is held by reference, so a host can still mutate a span after it was buffered.
            // Degrade to the old clone rather than break the never-throws contract report() and logs() also keep.
            body = flatJsonStringify(envelope);
        }
        return this.send({
            url,
            headers: this.ingestHeaders(key),
            body,
            label: 'Flare traces',
            debug,
            keepalive,
        });
    }

    private ingestHeaders(key: string | null): Record<string, string> {
        return {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-token': key ?? '',
        };
    }

    private send(request: {
        url: string;
        headers: Record<string, string>;
        body: string;
        label: string;
        debug: boolean;
        keepalive: boolean;
    }): Promise<void> {
        const { url, headers, body, label, debug, keepalive: keepaliveRequested } = request;
        // Only the keepalive gate below reads this, and report() never requests keepalive. Encoding a large
        // report body here allocated a Uint8Array of that size on the error path for nothing.
        const bytes = keepaliveRequested ? utf8Bytes(body) : 0;
        const keepalive =
            keepaliveRequested &&
            this.pendingKeepaliveRequests < MAX_PENDING_KEEPALIVE_REQUESTS &&
            this.pendingKeepaliveBytes + bytes <= MAX_PENDING_KEEPALIVE_BYTES;

        if (keepalive) {
            this.pendingKeepaliveBytes += bytes;
            this.pendingKeepaliveRequests += 1;
        }

        return fetch(url, { method: 'POST', keepalive, headers, body })
            .then(
                (response) => {
                    if (debug && response.status !== 201) {
                        console.error(`Received response with status ${response.status} from ${label}`);
                    }
                },
                (error) => {
                    if (debug) {
                        console.error(error);
                    }
                },
            )
            .finally(() => {
                if (keepalive) {
                    this.pendingKeepaliveBytes -= bytes;
                    this.pendingKeepaliveRequests -= 1;
                }
            });
    }
}
