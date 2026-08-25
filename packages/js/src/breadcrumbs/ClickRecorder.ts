import { BrowserSpanEventType, defaultNowNano } from '@flareapp/core';

import type { BreadcrumbHost, BreadcrumbRecorder } from './types';
import { onDocumentEvent } from './utils/documentEvent';
import { elementAttributes, interactiveTarget } from './utils/elementSelector';

export class ClickRecorder implements BreadcrumbRecorder {
    readonly type = BrowserSpanEventType.Click;

    constructor(private host: BreadcrumbHost) {
        this.onClick = this.onClick.bind(this);
    }

    install() {
        return onDocumentEvent('click', this.onClick);
    }

    private onClick(event: Event) {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        this.host.record(this.type, elementAttributes(interactiveTarget(target)), defaultNowNano());
    }
}
