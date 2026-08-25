import { BrowserSpanEventType, defaultNowNano } from '@flareapp/core';

import { onDocumentEvent } from './documentEvent';
import { elementAttributes } from './elementSelector';
import type { BreadcrumbHost, BreadcrumbRecorder } from './types';

export class FormChangeRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.Input;

    constructor(private host: BreadcrumbHost) {
        this.onChange = this.onChange.bind(this);
    }

    install() {
        return onDocumentEvent('change', this.onChange);
    }

    private onChange(event: Event) {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        this.host.record(this.type, elementAttributes(target), defaultNowNano());
    }
}
