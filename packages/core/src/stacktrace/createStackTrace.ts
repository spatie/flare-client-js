import ErrorStackParser from 'error-stack-parser';

import { StackFrame } from '../types';
import { assert } from '../util';
import type { FileReader } from './fileReader';
import { getCodeSnippet } from './fileReader';

export function createStackTrace(error: Error, debug: boolean, fileReader: FileReader): Promise<Array<StackFrame>> {
    return new Promise((resolve) => {
        if (!hasStack(error)) {
            return resolve([fallbackFrame('stacktrace missing')]);
        }

        let parsedFrames;
        try {
            parsedFrames = ErrorStackParser.parse(error);
        } catch (parseError) {
            assert(false, "Couldn't parse stacktrace of below error:", debug);
            if (debug) {
                console.error(parseError);
                console.error(error);
            }
            return resolve([fallbackFrame('stacktrace could not be parsed')]);
        }

        Promise.all(
            parsedFrames.map((frame) => {
                const fileName = normalizeFileName(frame.fileName);
                return getCodeSnippet(fileReader, fileName, frame.lineNumber, frame.columnNumber).then((snippet) => ({
                    lineNumber: frame.lineNumber || 1,
                    columnNumber: frame.columnNumber || 1,
                    method: frame.functionName || 'Anonymous or unknown function',
                    file: fileName || 'Unknown file',
                    codeSnippet: snippet.codeSnippet,
                    class: '',
                    isApplicationFrame: isApplicationFrame(fileName),
                }));
            }),
        ).then(resolve);
    });
}

// Hermes (RN's default engine) emits frames like `onPress@address at index.android.bundle:1:1234`. error-stack-parser
// keeps the `address at ` literal in the fileName, breaking sourcemap matching and source display. Strip it so `file`
// is the real bundle path. No real path begins with `address at `, so this is a no-op on other engines.
const HERMES_ADDRESS_PREFIX = 'address at ';

function normalizeFileName(fileName: string | undefined): string | undefined {
    if (fileName?.startsWith(HERMES_ADDRESS_PREFIX)) {
        return fileName.slice(HERMES_ADDRESS_PREFIX.length);
    }
    return fileName;
}

function fallbackFrame(reason: string): StackFrame {
    return {
        lineNumber: 0,
        columnNumber: 0,
        method: 'unknown',
        file: 'unknown',
        codeSnippet: { 0: `Could not read from file: ${reason}` },
        class: 'unknown',
    };
}

// Some engines populate `err.stack` with just `"<Name>: <message>"` (no frames) when an Error is
// constructed but never thrown. Treat that as "no stack" so we fall back instead of parsing garbage.
// Also accepts the legacy `stacktrace` and Opera `opera#sourceloc` properties.
function hasStack(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as Record<string, unknown>;
    const stack = e.stack ?? e.stacktrace ?? e['opera#sourceloc'];
    return (
        typeof stack === 'string' &&
        stack !== `${(e as { name?: string }).name}: ${(e as { message?: string }).message}`
    );
}

function isApplicationFrame(fileName: string | undefined): boolean {
    if (!fileName) return true;
    // node_modules and webpack-style vendor chunks should not count as application code
    if (/[/\\]node_modules[/\\]/.test(fileName)) return false;
    if (/(^|[/\\])(vendor|vendors)[.~-][^/\\]*\.js/i.test(fileName)) return false;
    return true;
}
