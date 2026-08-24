import { ClickRecorder } from './ClickRecorder';
import { FormChangeRecorder } from './FormChangeRecorder';
import { NavigationRecorder } from './NavigationRecorder';
import { RequestRecorder } from './RequestRecorder';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export type { BreadcrumbHost, BreadcrumbRecorder };
export { ClickRecorder, FormChangeRecorder, NavigationRecorder, RequestRecorder };
export { elementSelector, elementTestId, interactiveTarget } from './elementSelector';

/**
 * Starts every recorder and hands back one teardown for all of them.
 *
 * A recorder that throws while it installs is skipped. One broken recorder must not cost the others,
 * and it must never reach the app.
 */
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
