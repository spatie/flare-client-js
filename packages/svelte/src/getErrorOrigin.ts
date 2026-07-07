import type ErrorStackParser from 'error-stack-parser';

import type { SvelteErrorOrigin } from './types.js';

// Origins are indistinguishable at the boundary catch site; the stack trace is the only signal.
// Checked in priority order event > effect > render > unknown, so an event handler inside a
// component wins over the .svelte filename check.

// Inline event handlers and DOM event API calls. Svelte compiles `onclick={handler}` to
// `.onclick = ...` or `addEventListener(...)`, so these match compiled output and manual DOM calls.
const EVENT_PATTERNS = [
    /\.onclick\b/i,
    /\.onsubmit\b/i,
    /\.onchange\b/i,
    /\.oninput\b/i,
    /\.onkeydown\b/i,
    /\.onkeyup\b/i,
    /\.onfocus\b/i,
    /\.onblur\b/i,
    /\.onmouse/i,
    /\.onpointer/i,
    /\.ontouch/i,
    /addEventListener/,
    /dispatchEvent/,
    /EventTarget\./,
    /HTMLElement\./,
    /HTMLButtonElement\./,
    /HTMLInputElement\./,
    /HTMLFormElement\./,
];

// Async side-effects: $effect callbacks (Svelte 5 schedules via queueMicrotask), onMount
// microtasks, promise continuations, MutationObserver callbacks. Not render-phase code.
const EFFECT_PATTERNS = [/queueMicrotask/, /Promise\.then/, /Promise\.catch/, /MutationObserver/];

/**
 * Classify a parsed stack trace's error origin: 'event' (DOM handler), 'effect' (async side-effect),
 * 'render' (component render phase), or 'unknown' (no frames or no recognizable pattern).
 */
export function getErrorOrigin(frames: ErrorStackParser.StackFrame[]): SvelteErrorOrigin {
    if (frames.length === 0) {
        return 'unknown';
    }

    // Flatten each frame into one searchable string for regex matching.
    const frameStrings = frames.map((f) => `${f.functionName ?? ''} ${f.fileName ?? ''} ${f.source ?? ''}`);

    // Event patterns first (highest priority).
    if (frameStrings.some((s) => EVENT_PATTERNS.some((p) => p.test(s)))) {
        return 'event';
    }

    if (frameStrings.some((s) => EFFECT_PATTERNS.some((p) => p.test(s)))) {
        return 'effect';
    }

    // A .svelte frame that matched neither event nor effect is most likely the synchronous render phase.
    const hasSvelteFrame = frames.some((f) => f.fileName?.includes('.svelte'));

    if (hasSvelteFrame) {
        return 'render';
    }

    return 'unknown';
}
