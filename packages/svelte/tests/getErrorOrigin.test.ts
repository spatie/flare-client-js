import ErrorStackParser from 'error-stack-parser';
import { describe, expect, test } from 'vitest';

import { getErrorOrigin } from '../src/getErrorOrigin';

function makeFrames(lines: string[]): ErrorStackParser.StackFrame[] {
    const error = new Error('test');
    error.stack = ['Error: test', ...lines.map((l) => `    at ${l}`)].join('\n');

    return ErrorStackParser.parse(error);
}

describe('getErrorOrigin', () => {
    test('detects event origin from DOM event dispatch frames', () => {
        const frames = makeFrames([
            'handleClick (http://localhost:5173/src/lib/Button.svelte:5:9)',
            'HTMLButtonElement.onclick (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });

    test('detects event origin from addEventListener pattern', () => {
        const frames = makeFrames([
            'callback (http://localhost:5173/src/lib/Form.svelte:10:5)',
            'EventTarget.addEventListener (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });

    test('detects event origin from dispatchEvent', () => {
        const frames = makeFrames([
            'handler (http://localhost:5173/src/lib/Input.svelte:3:1)',
            'EventTarget.dispatchEvent (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });

    test('detects effect origin from queueMicrotask', () => {
        const frames = makeFrames([
            'update (http://localhost:5173/src/lib/Counter.svelte:8:5)',
            'flush (http://localhost:5173/node_modules/svelte/internal:200:3)',
            'queueMicrotask (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('effect');
    });

    test('detects effect origin from Promise.then', () => {
        const frames = makeFrames([
            'callback (http://localhost:5173/src/lib/Loader.svelte:15:3)',
            'Promise.then (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('effect');
    });

    test('detects render origin from synchronous svelte-only stack', () => {
        const frames = makeFrames([
            'Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
            'Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
            'App (http://localhost:5173/src/App.svelte:1:1)',
        ]);

        expect(getErrorOrigin(frames)).toBe('render');
    });

    test('returns unknown when no svelte frames and no recognizable pattern', () => {
        const frames = makeFrames([
            'someFunction (http://localhost:5173/src/utils.ts:5:1)',
            'main (http://localhost:5173/src/main.ts:1:1)',
        ]);

        expect(getErrorOrigin(frames)).toBe('unknown');
    });

    test('returns unknown for empty frames', () => {
        expect(getErrorOrigin([])).toBe('unknown');
    });

    test('event takes priority over effect when both signals present', () => {
        const frames = makeFrames([
            'handler (http://localhost:5173/src/lib/Button.svelte:5:9)',
            'HTMLButtonElement.onclick (native)',
            'queueMicrotask (native)',
        ]);

        expect(getErrorOrigin(frames)).toBe('event');
    });
});
