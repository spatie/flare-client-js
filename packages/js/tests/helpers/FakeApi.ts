import { Api } from '../../src/api';
import { Config, Report } from '../../src/types';

export class FakeApi extends Api {
    reports: Report[] = [];

    lastReport?: Report;
    lastConfig?: Config;

    report(report: Report, config: Config): Promise<void> {
        this.reports.push(report);
        this.lastReport = report;
        this.lastConfig = config;

        return Promise.resolve();
    }
}
