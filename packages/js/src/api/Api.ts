import { Config, Report } from '../types';
import { flatJsonStringify } from '../util';

import { mapToV2Wire } from './mapToV2Wire';

export class Api {
    report(report: Report, config: Config): Promise<void> {
        return fetch(config.reportingUrl, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Api-Token': config.key ?? '',
                'X-Flare-Client-Version': '2',
            },
            body: flatJsonStringify(mapToV2Wire(report, config)),
        }).then(
            (response) => {
                if (response.status !== 201) {
                    console.error(`Received response with status ${response.status} from Flare`);
                }
            },
            (error) => console.error(error)
        );
    }
}
