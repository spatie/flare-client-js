import { LogsEnvelope, Report, TracesEnvelope } from '../types';
import { flatJsonStringify } from '../util';

// A browser rejects a keepalive fetch when the sum of its body and every other in-flight keepalive body exceeds ~64 KiB
// (Fetch spec). logs and traces share one Api, so on pagehide two ~60 KB envelopes would breach that and one would be
// dropped. Track the in-flight total and downgrade a request to a normal fetch when it would breach the budget. A
// downgraded request still ships on soft backgrounding, and on a real unload is no worse off than the rejection.
const MAX_PENDING_KEEPALIVE_BYTES = 60_000;
const MAX_PENDING_KEEPALIVE_REQUESTS = 15;

const textEncoder = new TextEncoder();

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
        return this.send(
            url,
            {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Api-Token': key ?? '',
                'X-Report-Browser-Extension-Errors': JSON.stringify(reportBrowserExtensionErrors),
                'X-Flare-Client-Version': '2',
            },
            flatJsonStringify(report),
            'Flare',
            debug,
            false,
        );
    }

    logs(
        envelope: LogsEnvelope,
        url: string,
        key: string | null,
        debug: boolean = false,
        keepalive: boolean = false,
    ): Promise<void> {
        return this.send(url, this.ingestHeaders(key), flatJsonStringify(envelope), 'Flare logs', debug, keepalive);
    }

    traces(
        envelope: TracesEnvelope,
        url: string,
        key: string | null,
        debug: boolean = false,
        keepalive: boolean = false,
    ): Promise<void> {
        return this.send(url, this.ingestHeaders(key), flatJsonStringify(envelope), 'Flare traces', debug, keepalive);
    }

    private ingestHeaders(key: string | null): Record<string, string> {
        return {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'x-api-token': key ?? '',
        };
    }

    private send(
        url: string,
        headers: Record<string, string>,
        body: string,
        label: string,
        debug: boolean,
        keepaliveRequested: boolean,
    ): Promise<void> {
        const bytes = textEncoder.encode(body).length;
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
