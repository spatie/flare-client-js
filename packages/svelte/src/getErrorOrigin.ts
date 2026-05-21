import type ErrorStackParser from 'error-stack-parser';

import type { SvelteErrorOrigin } from './types.js';

// Heuristic classification of where a Svelte error originated, based on stack frame inspection.
//
// Svelte's onMount/beforeUpdate/$effect callbacks, DOM event handlers, and render functions
// all produce errors that look identical at the catch site (the error boundary sees a plain Error
// either way). The only distinguishing signal is the stack trace: different origins leave
// recognizable function names, file names, or DOM API calls in the frames.
//
// We check patterns in priority order: event > effect > render > unknown.
// Priority matters because an event handler inside a Svelte component would match both
// EVENT_PATTERNS and the .svelte filename check; we want 'event' to win.

// Inline event handlers (onclick, onsubmit, ...) and DOM event API calls.
// Browsers compile `onclick={handler}` to `.onclick = ...` or `addEventListener(...)`,
// so these patterns catch both Svelte's compiled output and manual DOM calls.
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

// Async side-effects: $effect callbacks, onMount microtasks, promise continuations.
// Svelte 5 schedules effects via queueMicrotask; promise chains and MutationObserver
// callbacks are also async side-effects, not render-phase code.
const EFFECT_PATTERNS = [/queueMicrotask/, /Promise\.then/, /Promise\.catch/, /MutationObserver/];

// Inspects a parsed stack trace and classifies the error origin into one of:
//   'event'   - error happened in a DOM event handler
//   'effect'  - error happened in an async side-effect ($effect, onMount, promise)
//   'render'  - error happened during Svelte component render (template/script top-level)
//   'unknown' - no frames or no recognizable pattern
export function getErrorOrigin(frames: ErrorStackParser.StackFrame[]): SvelteErrorOrigin {
    if (frames.length === 0) {
        return 'unknown';
    }

    // Flatten each frame into a single searchable string so regex matching is straightforward.
    const frameStrings = frames.map((f) => `${f.functionName ?? ''} ${f.fileName ?? ''} ${f.source ?? ''}`);

    // Check event patterns first (highest priority).
    if (frameStrings.some((s) => EVENT_PATTERNS.some((p) => p.test(s)))) {
        return 'event';
    }

    // Then async effect patterns.
    if (frameStrings.some((s) => EFFECT_PATTERNS.some((p) => p.test(s)))) {
        return 'effect';
    }

    // If any frame originates from a .svelte file but didn't match event/effect,
    // the error most likely occurred during the synchronous render phase.
    const hasSvelteFrame = frames.some((f) => f.fileName?.includes('.svelte'));

    if (hasSvelteFrame) {
        return 'render';
    }

    return 'unknown';
}
