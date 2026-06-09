import { Api, type Report } from '@flareapp/core';

export class FakeApi extends Api {
    reports: Report[] = [];

    lastReport?: Report;
    lastUrl?: string;
    lastKey?: string | null;
    lastReportBrowserExtensionErrors?: boolean;

    report(report: Report, url: string, key: string | null, reportBrowserExtensionErrors: boolean): Promise<void> {
        this.reports.push(report);
        this.lastUrl = url;
        this.lastKey = key;
        this.lastReportBrowserExtensionErrors = reportBrowserExtensionErrors;
        this.lastReport = report;
        return Promise.resolve();
    }
}
