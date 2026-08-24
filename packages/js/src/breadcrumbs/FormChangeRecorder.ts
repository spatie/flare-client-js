import { BrowserSpanEventType, defaultNowNano, type Attributes } from '@flareapp/core';

import { elementSelector, elementTestId } from './elementSelector';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export class FormChangeRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.Input;

    constructor(private host: BreadcrumbHost) {
        this.onChange = this.onChange.bind(this);
    }

    install() {
        document.addEventListener('change', this.onChange, true);
        return () => document.removeEventListener('change', this.onChange, true);
    }

    private onChange(event: Event) {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const attributes: Attributes = { 'browser.element.selector': elementSelector(target) };
        const testId = elementTestId(target);
        if (testId) {
            attributes['browser.element.test_id'] = testId;
        }
        this.host.record(this.type, attributes, defaultNowNano());
    }
}
