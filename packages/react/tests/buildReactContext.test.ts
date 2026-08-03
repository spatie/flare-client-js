import { version as reactVersion } from 'react';
import { describe, expect, test } from 'vitest';

import { buildReactContext } from '../src/buildReactContext';

const stack = '\n    at App (http://localhost:5173/src/App.tsx:5:3)\n';

describe('buildReactContext', () => {
    test('includes the React version on every context', () => {
        const context = buildReactContext(stack);

        expect(context.react.version).toBe(reactVersion);
    });

    test('parses component stack into componentStack and componentStackFrames', () => {
        const context = buildReactContext(stack);

        expect(context.react.componentStack).toEqual(['at App (http://localhost:5173/src/App.tsx:5:3)']);
        expect(context.react.componentStackFrames).toEqual([
            { component: 'App', file: 'http://localhost:5173/src/App.tsx', line: 5, column: 3 },
        ]);
    });
});
