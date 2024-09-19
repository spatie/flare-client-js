import { Report } from '../../src/types';
import { Api } from '../../src/api';

export class FakeApi extends Api {
    reports: Report[] = [];

    report(report: Report): Promise<void> {
        this.reports.push(report);

        return Promise.resolve();
    }

    get lastReport(): Report | undefined {
        return this.reports[this.reports.length - 1];
    }
}
