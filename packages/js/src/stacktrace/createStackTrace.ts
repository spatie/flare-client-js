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

            return resolve([
                {
                    lineNumber: 0,
                    columnNumber: 0,
                    method: 'unknown',
                    file: 'unknown',
                    codeSnippet: {
                        0: 'Could not read from file: stacktrace missing',
                    },
                    class: 'unknown',
                },
            ]);
        }

        Promise.all(
            ErrorStackParser.parse(error).map((frame) => {
                return new Promise<StackFrame>((resolve) => {
                    getCodeSnippet(frame.fileName, frame.lineNumber, frame.columnNumber).then((snippet) => {
                        resolve({
                            lineNumber: frame.lineNumber || 1,
                            columnNumber: frame.columnNumber || 1,
                            method: frame.functionName || 'Anonymous or unknown function',
                            file: frame.fileName || 'Unknown file',
                            codeSnippet: snippet.codeSnippet,
                            class: '',
                            isApplicationFrame: true,
                        });
                    });
                });
            })
        ).then(resolve);
    });
}

function hasStack(err: any): boolean {
    return (
        !!err &&
        (!!err.stack || !!err.stacktrace || !!err['opera#sourceloc']) &&
        typeof (err.stack || err.stacktrace || err['opera#sourceloc']) === 'string' &&
        err.stack !== `${err.name}: ${err.message}`
    );
}
