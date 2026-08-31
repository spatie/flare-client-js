import type { Attributes } from '@flareapp/core';

const INTERACTIVE_HTML_ELEMENTS = 'button, a, input, select, textarea, label, [role], [tabindex], [onclick]';
const MAX_ANCESTOR_DEPTH = 5;

export function interactiveTarget(target: Element): Element {
    let element: Element | null = target;
    for (let depth = 0; element && depth < MAX_ANCESTOR_DEPTH; depth++) {
        if (element.matches?.(INTERACTIVE_HTML_ELEMENTS)) {
            return element;
        }
        element = element.parentElement;
    }
    return target;
}

// CSS selector for the element, for example button#my-button.
export function elementSelector(element: Element): string {
    let selector = element.tagName.toLowerCase();
    if (element.id) {
        selector += `#${element.id}`;
    }
    for (const className of element.classList) {
        selector += `.${className}`;
    }
    return selector;
}

export function elementTestId(element: Element): string | undefined {
    return element.getAttribute?.('data-testid') ?? undefined;
}

export function elementAttributes(element: Element): Attributes {
    const attributes: Attributes = { 'browser.element.selector': elementSelector(element) };
    const testId = elementTestId(element);
    if (testId) {
        attributes['browser.element.test_id'] = testId;
    }
    return attributes;
}
