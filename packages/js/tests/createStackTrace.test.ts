import { expect, test, vi } from 'vitest';

import { createStackTrace } from '../src/stacktrace/createStackTrace';

vi.mock('error-stack-parser', () => ({
    default: {
        parse: () => {
            throw new Error('parser exploded');
        },
    },
}));

test('resolves to a single fallback frame when the parser throws', async () => {
    const error = new Error('boom');

    const frames = await createStackTrace(error, false);

    expect(frames).toHaveLength(1);
    expect(frames[0].file).toBe('unknown');
    expect(frames[0].method).toBe('unknown');
    expect(frames[0].line_number).toBe(0);
    expect(frames[0].code_snippet).toEqual({ 0: 'Could not parse stacktrace' });
});
