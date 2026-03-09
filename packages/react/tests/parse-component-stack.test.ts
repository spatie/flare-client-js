import { describe, expect, test } from 'vitest';

import { parseComponentStack } from '../src/parse-component-stack';

describe('parseComponentStack', () => {
    describe('Chrome format (at Component (file:line:col))', () => {
        test('parses frames with file, line, and column', () => {
            const stack = `
                at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)
                at App (http://localhost:5173/src/App.tsx:5:3)
            `;

            expect(parseComponentStack(stack)).toEqual([
                { component: 'ErrorComponent', file: 'http://localhost:5173/src/App.tsx', line: 12, column: 9 },
                { component: 'App', file: 'http://localhost:5173/src/App.tsx', line: 5, column: 3 },
            ]);
        });

        test('parses frames without file info', () => {
            const stack = `
                at div
                at span
            `;

            expect(parseComponentStack(stack)).toEqual([
                { component: 'div', file: null, line: null, column: null },
                { component: 'span', file: null, line: null, column: null },
            ]);
        });

        test('parses mixed frames', () => {
            const stack = `
                at ErrorComponent (http://localhost:5173/src/App.tsx:12:9)
                at div
                at App (http://localhost:5173/src/App.tsx:5:3)
            `;

            expect(parseComponentStack(stack)).toEqual([
                { component: 'ErrorComponent', file: 'http://localhost:5173/src/App.tsx', line: 12, column: 9 },
                { component: 'div', file: null, line: null, column: null },
                { component: 'App', file: 'http://localhost:5173/src/App.tsx', line: 5, column: 3 },
            ]);
        });
    });

    describe('Firefox/Safari format (Component@file:line:col)', () => {
        test('parses frames with file, line, and column', () => {
            const stack = `
                BuggyComponent@http://localhost:5173/react/BuggyComponent.tsx:17:9
                App@http://localhost:5173/react/App.tsx:26:45
            `;

            expect(parseComponentStack(stack)).toEqual([
                {
                    component: 'BuggyComponent',
                    file: 'http://localhost:5173/react/BuggyComponent.tsx',
                    line: 17,
                    column: 9,
                },
                { component: 'App', file: 'http://localhost:5173/react/App.tsx', line: 26, column: 45 },
            ]);
        });

        test('parses frames with @fs paths', () => {
            const stack =
                'FlareErrorBoundary@http://localhost:5173/@fs/Users/seb/project/packages/react/src/FlareErrorBoundary.ts:5:8';

            expect(parseComponentStack(stack)).toEqual([
                {
                    component: 'FlareErrorBoundary',
                    file: 'http://localhost:5173/@fs/Users/seb/project/packages/react/src/FlareErrorBoundary.ts',
                    line: 5,
                    column: 8,
                },
            ]);
        });
    });

    describe('edge cases', () => {
        test('returns empty array for empty input', () => {
            expect(parseComponentStack('')).toEqual([]);
        });

        test('returns empty array for whitespace-only input', () => {
            expect(parseComponentStack('   \n   \n   ')).toEqual([]);
        });

        test('handles unrecognized lines as component-only frames', () => {
            const stack = 'something unexpected';

            expect(parseComponentStack(stack)).toEqual([
                { component: 'something unexpected', file: null, line: null, column: null },
            ]);
        });
    });
});
