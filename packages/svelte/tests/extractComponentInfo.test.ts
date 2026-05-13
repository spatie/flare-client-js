import ErrorStackParser from 'error-stack-parser';
import { describe, expect, test } from 'vitest';

import { extractComponentInfo } from '../src/extractComponentInfo';

function parseStack(stack: string): ErrorStackParser.StackFrame[] {
    const error = new Error('test');
    error.stack = stack;

    try {
        return ErrorStackParser.parse(error);
    } catch {
        return [];
    }
}

describe('extractComponentInfo', () => {
    test('extracts component name and hierarchy from dev-like stack trace', () => {
        const frames = parseStack(
            [
                'Error: test',
                '    at Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
                '    at Object.children (http://localhost:5173/src/lib/Card.svelte:8:3)',
                '    at Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
                '    at Layout (http://localhost:5173/src/routes/Layout.svelte:3:1)',
                '    at App (http://localhost:5173/src/App.svelte:1:1)',
            ].join('\n')
        );

        const result = extractComponentInfo(frames);

        expect(result.componentName).toBe('Button');
        expect(result.componentHierarchy).toEqual(['Button', 'Card', 'Layout', 'App']);
    });

    test('extracts component name from fileName when functionName is unavailable', () => {
        const frames = parseStack(
            ['Error: test', '    at http://localhost:5173/src/lib/MyComponent.svelte:10:5'].join('\n')
        );

        const result = extractComponentInfo(frames);

        expect(result.componentName).toBe('MyComponent');
        expect(result.componentHierarchy).toEqual(['MyComponent']);
    });

    test('deduplicates consecutive identical component names', () => {
        const frames = parseStack(
            [
                'Error: test',
                '    at Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
                '    at Button (http://localhost:5173/src/lib/Button.svelte:8:3)',
                '    at Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
            ].join('\n')
        );

        const result = extractComponentInfo(frames);

        expect(result.componentName).toBe('Button');
        expect(result.componentHierarchy).toEqual(['Button', 'Card']);
    });

    test('returns null name and empty hierarchy when no .svelte frames found', () => {
        const frames = parseStack(
            [
                'Error: test',
                '    at someFunction (http://localhost:5173/src/utils.ts:5:1)',
                '    at main (http://localhost:5173/src/main.ts:1:1)',
            ].join('\n')
        );

        const result = extractComponentInfo(frames);

        expect(result.componentName).toBeNull();
        expect(result.componentHierarchy).toEqual([]);
    });

    test('returns null name and empty hierarchy for production mangled stack', () => {
        const frames = parseStack(
            [
                'Error: test',
                '    at Qe (http://example.com/assets/svelte-abc123.js:42:15)',
                '    at jt (http://example.com/assets/svelte-abc123.js:38:10)',
            ].join('\n')
        );

        const result = extractComponentInfo(frames);

        expect(result.componentName).toBeNull();
        expect(result.componentHierarchy).toEqual([]);
    });

    test('handles empty frames array gracefully', () => {
        const result = extractComponentInfo([]);

        expect(result.componentName).toBeNull();
        expect(result.componentHierarchy).toEqual([]);
    });

    test('filters out non-svelte frames from hierarchy', () => {
        const frames = parseStack(
            [
                'Error: test',
                '    at throwError (http://localhost:5173/src/utils.ts:5:1)',
                '    at Button (http://localhost:5173/src/lib/Button.svelte:12:5)',
                '    at createEffect (http://localhost:5173/node_modules/svelte/internal:100:5)',
                '    at Card (http://localhost:5173/src/lib/Card.svelte:5:1)',
            ].join('\n')
        );

        const result = extractComponentInfo(frames);

        expect(result.componentName).toBe('Button');
        expect(result.componentHierarchy).toEqual(['Button', 'Card']);
    });
});
