import ErrorStackParser from 'error-stack-parser';

import { StackFrame } from '../types';
import { assert } from '../util';

import { getCodeSnippet } from './fileReader';

export function createStackTrace(error: Error, debug: boolean): Promise<Array<StackFrame>> {
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
                return getCodeSnippet(frame.fileName, frame.lineNumber, frame.columnNumber).then((snippet) => ({
                    lineNumber: frame.lineNumber || 1,
                    columnNumber: frame.columnNumber || 1,
                    method: frame.functionName || 'Anonymous or unknown function',
                    file: frame.fileName || 'Unknown file',
                    codeSnippet: snippet.codeSnippet,
                    class: '',
                    isApplicationFrame: isApplicationFrame(frame.fileName),
                }));
            })
        ).then(resolve);
    });
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
function hasStack(err: any): boolean {
    return (
        !!err &&
        (!!err.stack || !!err.stacktrace || !!err['opera#sourceloc']) &&
        typeof (err.stack || err.stacktrace || err['opera#sourceloc']) === 'string' &&
        err.stack !== `${err.name}: ${err.message}`
    );
}

function isApplicationFrame(fileName: string | undefined): boolean {
    if (!fileName) return true;
    // node_modules and webpack-style vendor chunks should not count as application code
    if (/[/\\]node_modules[/\\]/.test(fileName)) return false;
    if (/(^|[/\\])(vendor|vendors)[.~-][^/\\]*\.js/i.test(fileName)) return false;
    return true;
}
