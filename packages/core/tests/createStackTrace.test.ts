// @vitest-environment jsdom
import ErrorStackParser from 'error-stack-parser';
import { expect, test, vi } from 'vitest';

import { createStackTrace } from '../src/stacktrace/createStackTrace';
import { NullFileReader } from '../src/stacktrace/NullFileReader';

vi.mock('error-stack-parser', () => ({
    default: {
        parse: vi.fn(() => {
            throw new Error('parser broke on malformed stack');
        }),
    },
}));

const nullReader = new NullFileReader();

test('resolves (does not reject) when ErrorStackParser throws', async () => {
    const error = new Error('boom');
    // ensure hasStack() returns true so we reach the parse call
    error.stack = 'Error: boom\n    at fn (file.js:1:1)\n    at fn2 (file.js:2:2)';

    await expect(createStackTrace(error, false, nullReader)).resolves.toBeDefined();
});

test('returns a fallback frame array when ErrorStackParser throws', async () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file.js:1:1)';

    const frames = await createStackTrace(error, false, nullReader);

    expect(Array.isArray(frames)).toBe(true);
    expect(frames.length).toBeGreaterThan(0);
});

test('strips the Hermes "address at " prefix from frame file names', async () => {
    (ErrorStackParser.parse as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => [
        {
            fileName: 'address at index.android.bundle',
            lineNumber: 1,
            columnNumber: 12345,
            functionName: 'onPress',
        },
    ]);

    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file.js:1:1)';

    const frames = await createStackTrace(error, false, nullReader);

    expect(frames[0].file).toBe('index.android.bundle');
});

test('leaves a normal (non-Hermes) file name untouched', async () => {
    (ErrorStackParser.parse as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => [
        { fileName: 'https://cdn.test/app/src/index.js', lineNumber: 1, columnNumber: 1, functionName: 'fn' },
    ]);

    const error = new Error('boom');
    error.stack = 'Error: boom\n    at fn (file.js:1:1)';

    const frames = await createStackTrace(error, false, nullReader);

    expect(frames[0].file).toBe('https://cdn.test/app/src/index.js');
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

    const frames = await createStackTrace(error, false, nullReader);

    expect(frames[0].isApplicationFrame).toBe(false);
    expect(frames[1].isApplicationFrame).toBe(true);
});
