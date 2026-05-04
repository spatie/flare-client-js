import { describe, expect, test } from 'vitest';

import { parseComponentStack } from '../src/parseComponentStack';

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

    describe('dotted component names', () => {
        test('parses Chrome frames with dotted names (Context.Provider, React.Fragment)', () => {
            const stack = `
                at Context.Provider (http://localhost:5173/src/App.tsx:8:5)
                at React.Fragment
            `;

            expect(parseComponentStack(stack)).toEqual([
                { component: 'Context.Provider', file: 'http://localhost:5173/src/App.tsx', line: 8, column: 5 },
                { component: 'React.Fragment', file: null, line: null, column: null },
            ]);
        });

        test('parses Firefox frames with dotted names', () => {
            const stack = 'Namespace.Component@http://localhost:5173/src/App.tsx:10:3';

            expect(parseComponentStack(stack)).toEqual([
                { component: 'Namespace.Component', file: 'http://localhost:5173/src/App.tsx', line: 10, column: 3 },
            ]);
        });
    });

    describe('complex file paths', () => {
        test('parses Chrome frames with port in URL', () => {
            const stack = 'at App (http://192.168.1.5:3000/static/js/main.chunk.js:42:7)';

            expect(parseComponentStack(stack)).toEqual([
                { component: 'App', file: 'http://192.168.1.5:3000/static/js/main.chunk.js', line: 42, column: 7 },
            ]);
        });

        test('parses Firefox frames with multiple colons in path', () => {
            const stack = 'App@http://localhost:5173/node_modules/.vite/deps/chunk-ABC123.js:99:12';

            expect(parseComponentStack(stack)).toEqual([
                {
                    component: 'App',
                    file: 'http://localhost:5173/node_modules/.vite/deps/chunk-ABC123.js',
                    line: 99,
                    column: 12,
                },
            ]);
        });

        test('parses Firefox frames with @fs Vite paths containing @-scoped packages', () => {
            const stack =
                'Button@http://localhost:5173/@fs/Users/dev/project/node_modules/@radix-ui/react-button/dist/index.mjs:14:3';

            expect(parseComponentStack(stack)).toEqual([
                {
                    component: 'Button',
                    file: 'http://localhost:5173/@fs/Users/dev/project/node_modules/@radix-ui/react-button/dist/index.mjs',
                    line: 14,
                    column: 3,
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

        test('strips leading "at " from unrecognized format lines', () => {
            const stack = 'at SomeWeirdFormat without parens or @';

            expect(parseComponentStack(stack)).toEqual([
                { component: 'SomeWeirdFormat without parens or @', file: null, line: null, column: null },
            ]);
        });

        test('handles large stacks without truncation', () => {
            const lines = Array.from(
                { length: 50 },
                (_, i) => `at Component${i} (http://localhost:5173/src/deep.tsx:${i + 1}:1)`
            );

            const result = parseComponentStack(lines.join('\n'));
            expect(result).toHaveLength(50);
            expect(result[49]).toEqual({
                component: 'Component49',
                file: 'http://localhost:5173/src/deep.tsx',
                line: 50,
                column: 1,
            });
        });
    });
});
