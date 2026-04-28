import { Report } from '../types';
import { flatJsonStringify } from '../util';

export class Api {
    report(report: Report, url: string, key: string | null, reportBrowserExtensionErrors: boolean): Promise<void> {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-token': key ?? '',
                'X-Report-Browser-Extension-Errors': JSON.stringify(reportBrowserExtensionErrors),
                'X-Flare-Client-Version': '2',
            },
            body: flatJsonStringify(report),
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
