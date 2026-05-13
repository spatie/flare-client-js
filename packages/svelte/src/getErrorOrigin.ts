import type ErrorStackParser from 'error-stack-parser';

import type { SvelteErrorOrigin } from './types';

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

const EFFECT_PATTERNS = [/queueMicrotask/, /Promise\.then/, /Promise\.catch/, /MutationObserver/];

export function getErrorOrigin(frames: ErrorStackParser.StackFrame[]): SvelteErrorOrigin {
    if (frames.length === 0) {
        return 'unknown';
    }

    const frameStrings = frames.map((f) => `${f.functionName ?? ''} ${f.fileName ?? ''} ${f.source ?? ''}`);

    if (frameStrings.some((s) => EVENT_PATTERNS.some((p) => p.test(s)))) {
        return 'event';
    }

    if (frameStrings.some((s) => EFFECT_PATTERNS.some((p) => p.test(s)))) {
        return 'effect';
    }

    const hasSvelteFrame = frames.some((f) => f.fileName?.includes('.svelte'));

    if (hasSvelteFrame) {
        return 'render';
    }

    return 'unknown';
}
