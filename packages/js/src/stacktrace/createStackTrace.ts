import ErrorStackParser from 'error-stack-parser';

import { StackFrame } from '../types';
import { assert } from '../util';

import { getCodeSnippet } from './fileReader';

export function createStackTrace(error: Error, debug: boolean): Promise<Array<StackFrame>> {
    return new Promise((resolve) => {
        if (!hasStack(error)) {
            assert(false, "Couldn't generate stacktrace of below error:", debug);

            if (debug) {
                console.error(error);
            }

            return resolve([fallbackFrame('stacktrace missing')]);
        }

        let parsed: ReturnType<typeof ErrorStackParser.parse>;
        try {
            parsed = ErrorStackParser.parse(error);
        } catch (parseError) {
            if (debug) {
                console.error('Flare: failed to parse stacktrace', parseError);
            }
            return resolve([fallbackFrame('Could not parse stacktrace')]);
        }

        Promise.all(
            parsed.map((frame) => {
                return new Promise<StackFrame>((resolve) => {
                    getCodeSnippet(frame.fileName, frame.lineNumber, frame.columnNumber).then((snippet) => {
                        resolve({
                            line_number: frame.lineNumber || 1,
                            column_number: frame.columnNumber || 1,
                            method: frame.functionName || 'Anonymous or unknown function',
                            file: frame.fileName || 'Unknown file',
                            code_snippet: snippet.codeSnippet,
                            trimmed_column_number: snippet.trimmedColumnNumber,
                            class: '',
                        });
                    });
                });
            })
        ).then(resolve);
    });
}

function fallbackFrame(message: string): StackFrame {
    return {
        line_number: 0,
        column_number: 0,
        method: 'unknown',
        file: 'unknown',
        code_snippet: { 0: message },
        trimmed_column_number: null,
        class: 'unknown',
    };
}

function hasStack(err: any): boolean {
    return (
        !!err &&
        (!!err.stack || !!err.stacktrace || !!err['opera#sourceloc']) &&
        typeof (err.stack || err.stacktrace || err['opera#sourceloc']) === 'string' &&
        err.stack !== `${err.name}: ${err.message}`
    );
}
