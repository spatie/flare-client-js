const INTERACTIVE = 'button, a, input, select, textarea, label, [role], [tabindex], [onclick]';
const MAX_ANCESTOR_DEPTH = 5;

/**
 * Finds the element a click is really about. A click on `<button><span>Buy</span></button>` targets the
 * span, and "span" tells nobody anything.
 *
 * Falls back to the target when nothing matches. React and Vue attach their handlers at the root, so a
 * `<div onClick>` has no `onclick` attribute and no role, and the DOM cannot say it is interactive.
 * Dropping those would lose exactly the clicks a modern app cares about.
 */
export function interactiveTarget(target: Element): Element {
    let element: Element | null = target;
    for (let depth = 0; element && depth < MAX_ANCESTOR_DEPTH; depth++) {
        if (element.matches?.(INTERACTIVE)) {
            return element;
        }
        element = element.parentElement;
    }
    return target;
}

/**
 * Names an element by tag, id and classes: `button#checkout.btn.btn-primary`.
 *
 * Text and input values are never read. An element's text is user data often enough (a name in a list
 * row, an email in a dropdown) that reading it by default would leak for teams who never open the
 * configuration docs.
 */
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

/** `data-testid` is the name a team already gave this element, so it beats any guess we could make. */
export function elementTestId(element: Element): string | undefined {
    return element.getAttribute?.('data-testid') ?? undefined;
}
