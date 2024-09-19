const cachedFiles: { [key: string]: string } = {};

type CodeSnippet = {
    [key: number]: string;
};

type ReaderResponse = {
    codeSnippet: CodeSnippet;
    trimmedColumnNumber: number | null;
};

export function getCodeSnippet(url?: string, lineNumber?: number, columnNumber?: number): Promise<ReaderResponse> {
    return new Promise((resolve) => {
        if (!url || !lineNumber) {
            return resolve({
                codeSnippet: {
                    0: `Could not read from file: missing file URL or line number. URL: ${url} lineNumber: ${lineNumber}`,
                },
                trimmedColumnNumber: null,
            });
        }

        readFile(url).then((fileText) => {
            if (!fileText) {
                return resolve({
                    codeSnippet: {
                        0: `Could not read from file: Error while opening file at URL ${url}`,
                    },
                    trimmedColumnNumber: null,
                });
            }

            return resolve(readLinesFromFile(fileText, lineNumber, columnNumber));
        });
    });
}

function readFile(url: string): Promise<string | null> {
    if (cachedFiles[url]) {
        return Promise.resolve(cachedFiles[url]);
    }

    return fetch(url)
        .then((response) => {
            if (response.status !== 200) {
                return null;
            }

            return response.text();
        })
        .catch(() => null);
}

export function readLinesFromFile(
    fileText: string,
    lineNumber: number,
    columnNumber?: number,
    maxSnippetLineLength = 1000,
    maxSnippetLines = 40
): ReaderResponse {
    const codeSnippet: CodeSnippet = {};
    let trimmedColumnNumber = null;

    const lines = fileText.split('\n');

    for (let i = -maxSnippetLines / 2; i <= maxSnippetLines / 2; i++) {
        const currentLineIndex = lineNumber + i;

        if (currentLineIndex >= 0 && lines[currentLineIndex]) {
            const displayLine = currentLineIndex + 1; // the linenumber in a stacktrace is not zero-based like an array

            if (lines[currentLineIndex].length > maxSnippetLineLength) {
                if (columnNumber && columnNumber + maxSnippetLineLength / 2 > maxSnippetLineLength) {
                    codeSnippet[displayLine] = lines[currentLineIndex].substr(
                        columnNumber - Math.round(maxSnippetLineLength / 2),
                        maxSnippetLineLength
                    );

                    if (displayLine === lineNumber) {
                        trimmedColumnNumber = Math.round(maxSnippetLineLength / 2);
                    }

                    continue;
                }

                codeSnippet[displayLine] = lines[currentLineIndex].substr(0, maxSnippetLineLength) + '…';

                continue;
            }

            codeSnippet[displayLine] = lines[currentLineIndex];
        }
    }

    return { codeSnippet, trimmedColumnNumber };
}
