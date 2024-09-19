import { Report } from '../types';
import { flatJsonStringify } from '../util';

export class Api {
    report(report: Report, url: string, key: string): Promise<void> {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'x-api-token': key,
            },
            body: flatJsonStringify({
                ...report,
                key: key,
            }),
        }).then(
            (response) => {
                if (response.status !== 204) {
                    console.error(
                        `Received response with status ${response.status} from Flare`,
                    );
                }
            },
            (error) => console.error(error),
        );
    }
}
