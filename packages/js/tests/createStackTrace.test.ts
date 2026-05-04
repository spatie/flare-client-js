// @vitest-environment jsdom
import ErrorStackParser from 'error-stack-parser';
import { expect, test, vi } from 'vitest';

import { createStackTrace } from '../src/stacktrace/createStackTrace';

vi.mock('error-stack-parser', () => ({
    default: {
        parse: vi.fn(() => {
            throw new Error('parser broke on malformed stack');
        }),
    },
}));

test('resolves (does not reject) when ErrorStackParser throws', async () => {
    const error = new Error('boom');
    // ensure hasStack() returns true so we reach the parse call
    error.stack = 'Error: boom\n    at fn (file.js:1:1)\n    at fn2 (file.js:2:2)';

    await expect(createStackTrace(error, false)).resolves.toBeDefined();
});

test('returns a fallback frame array when ErrorStackParser throws', async () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file.js:1:1)';

    const frames = await createStackTrace(error, false);

    expect(Array.isArray(frames)).toBe(true);
    expect(frames.length).toBeGreaterThan(0);
});

test('marks node_modules frames as non-application', async () => {
    (ErrorStackParser.parse as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => [
        {
            fileName: 'https://cdn.test/app/node_modules/lodash/index.js',
            lineNumber: 1,
            columnNumber: 1,
            functionName: 'lodash',
        },
        { fileName: 'https://cdn.test/app/src/main.ts', lineNumber: 2, columnNumber: 2, functionName: 'main' },
    ]);

    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file.js:1:1)';

    const frames = await createStackTrace(error, false);

    expect(frames[0].isApplicationFrame).toBe(false);
    expect(frames[1].isApplicationFrame).toBe(true);
});
