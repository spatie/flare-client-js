import { Report } from '../types';
import { flatJsonStringify } from '../util';

export class Api {
    report(report: Report, url: string, key: string | null, reportBrowserExtensionErrors: boolean): Promise<void> {
        return fetch(url, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Api-Token': key ?? '',
                'X-Report-Browser-Extension-Errors': JSON.stringify(reportBrowserExtensionErrors),
                // Payload format version. Bump when the Report shape changes in a way the backend must distinguish.
                'X-Flare-Client-Version': '2',
            },
            body: flatJsonStringify(report),
        }).then(
            // Failures are logged but never thrown: a broken error reporter must not crash the host app.
            (response) => {
                if (response.status !== 201) {
                    console.error(`Received response with status ${response.status} from Flare`);
                }
            },
            (error) => console.error(error)
        );
    }
}
