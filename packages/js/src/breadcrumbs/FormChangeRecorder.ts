import { BrowserSpanEventType, defaultNowNano, type Attributes } from '@flareapp/core';

import { elementSelector, elementTestId } from './elementSelector';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

/**
 * Records which form field a person finished, by name only. Never the value they typed.
 *
 * We listen to `change`, not `input`. `input` fires on every keystroke, so one email address is about
 * 25 entries and four fields would push every click and request out of the buffer.
 */
export class FormChangeRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.Input;

    constructor(private host: BreadcrumbHost) {
        this.onChange = this.onChange.bind(this);
    }

    install(): () => void {
        document.addEventListener('change', this.onChange, true);
        return () => document.removeEventListener('change', this.onChange, true);
    }

    private onChange(event: Event): void {
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
