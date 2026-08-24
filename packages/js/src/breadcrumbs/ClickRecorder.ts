import { BrowserSpanEventType, defaultNowNano, type Attributes } from '@flareapp/core';

import { elementSelector, elementTestId, interactiveTarget } from './elementSelector';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export class ClickRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.Click;

    constructor(private host: BreadcrumbHost) {
        this.onClick = this.onClick.bind(this);
    }

    install(): () => void {
        // Capture phase, so we still see a click an app stops from bubbling.
        document.addEventListener('click', this.onClick, true);
        return () => document.removeEventListener('click', this.onClick, true);
    }

    private onClick(event: Event): void {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const element = interactiveTarget(target);
        const attributes: Attributes = { 'browser.element.selector': elementSelector(element) };
        const testId = elementTestId(element);
        if (testId) {
            attributes['browser.element.test_id'] = testId;
        }
        this.host.record(this.type, attributes, defaultNowNano());
    }
}
