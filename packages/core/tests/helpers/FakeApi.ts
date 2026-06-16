import { Api } from '../../src/api';
import { LogsEnvelope, Report, TracesEnvelope } from '../../src/types';

export class FakeApi extends Api {
    reports: Report[] = [];
    logEnvelopes: LogsEnvelope[] = [];
    traceEnvelopes: TracesEnvelope[] = [];

    lastReport?: Report;
    lastUrl?: string;
    lastKey?: string | null;
    lastReportBrowserExtensionErrors?: boolean;

    lastLogUrl?: string;
    lastLogKey?: string | null;
    lastLogKeepalive?: boolean;

    lastTraceUrl?: string;
    lastTraceKey?: string | null;
    lastTraceKeepalive?: boolean;

    report(report: Report, url: string, key: string | null, reportBrowserExtensionErrors: boolean): Promise<void> {
        this.reports.push(report);
        this.lastUrl = url;
        this.lastKey = key;
        this.lastReportBrowserExtensionErrors = reportBrowserExtensionErrors;
        this.lastReport = report;
        return Promise.resolve();
    }

    logs(envelope: LogsEnvelope, url: string, key: string | null, _debug?: boolean, keepalive = false): Promise<void> {
        this.logEnvelopes.push(envelope);
        this.lastLogUrl = url;
        this.lastLogKey = key;
        this.lastLogKeepalive = keepalive;
        return Promise.resolve();
    }

    traces(
        envelope: TracesEnvelope,
        url: string,
        key: string | null,
        _debug?: boolean,
        keepalive = false,
    ): Promise<void> {
        this.traceEnvelopes.push(envelope);
        this.lastTraceUrl = url;
        this.lastTraceKey = key;
        this.lastTraceKeepalive = keepalive;
        return Promise.resolve();
    }
}
