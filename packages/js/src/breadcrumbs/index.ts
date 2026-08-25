import { ClickRecorder } from './ClickRecorder';
import { FormChangeRecorder } from './FormChangeRecorder';
import { NavigationRecorder } from './NavigationRecorder';
import { RequestRecorder } from './RequestRecorder';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export type { BreadcrumbHost, BreadcrumbRecorder };
export { ClickRecorder, FormChangeRecorder, NavigationRecorder, RequestRecorder };
export { elementAttributes, elementSelector, elementTestId, interactiveTarget } from './utils/elementSelector';

/** Starts every recorder, returns one teardown. A recorder that fails to install is skipped. */
export function startBreadcrumbs(host: BreadcrumbHost): () => void {
    if (typeof document === 'undefined') {
        return () => {};
    }

    const recorders: BreadcrumbRecorder[] = [
        new ClickRecorder(host),
        new FormChangeRecorder(host),
        new RequestRecorder(host),
        new NavigationRecorder(host),
    ];

    const teardowns: Array<() => void> = [];
    for (const recorder of recorders) {
        try {
            teardowns.push(recorder.install());
        } catch {}
    }

    return () => {
        for (const teardown of teardowns) {
            try {
                teardown();
            } catch {}
        }
    };
}
