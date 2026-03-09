import { describe, expect, test } from 'vitest';

import { formatComponentStack } from '../src/format-component-stack';

describe('formatComponentStack', () => {
    test('splits a component stack into lines', () => {
        const stack = `
            at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)
            at div
            at App (http://localhost:5173/src/App.tsx:5:3)
        `;

        expect(formatComponentStack(stack)).toEqual([
            'at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)',
            'at div',
            'at App (http://localhost:5173/src/App.tsx:5:3)',
        ]);
    });

    test('returns empty array for empty string', () => {
        expect(formatComponentStack('')).toEqual([]);
    });

    test('returns empty array for whitespace-only string', () => {
        expect(formatComponentStack('   \n   \n   ')).toEqual([]);
    });

    test('trims whitespace around newlines but not at string edges', () => {
        const stack = '   at Foo   \n   at Bar   ';

        expect(formatComponentStack(stack)).toEqual(['   at Foo', 'at Bar   ']);
    });

    test('filters out empty lines between components', () => {
        const stack = 'at Foo\n\n\nat Bar';

        expect(formatComponentStack(stack)).toEqual(['at Foo', 'at Bar']);
    });

    test('handles a single-line stack', () => {
        expect(formatComponentStack('at App')).toEqual(['at App']);
    });
});
