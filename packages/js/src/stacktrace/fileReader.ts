// Module-level cache: bundles fetched once per page load are reused across every frame in the trace.
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

        // Reject non-http(s) URLs (e.g. chrome-extension://, file://) to avoid leaking errors from
        // browser extensions or local files into the report. catchWindowErrors has a runtime opt-in
        // for extensions; this is the secondary gate at fetch time.
        if (!isFetchableUrl(url)) {
            return resolve({
                codeSnippet: {
                    0: `Could not read from file: unsupported URL scheme. URL: ${url}`,
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

function isFetchableUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
}

function readFile(url: string): Promise<string | null> {
    if (cachedFiles[url] !== undefined) {
        return Promise.resolve(cachedFiles[url]);
    }

    return fetch(url)
        .then((response) => {
            if (response.status !== 200) {
                return null;
            }

            return response.text();
        })
        .then((text) => {
            if (text !== null) {
                cachedFiles[url] = text;
            }
            return text;
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
    const errorLineIndex = lineNumber - 1; // stack line numbers are 1-based; array is 0-based
    const half = Math.floor(maxSnippetLines / 2);

    for (let i = -half; i <= half; i++) {
        const currentLineIndex = errorLineIndex + i;

        if (currentLineIndex < 0 || !lines[currentLineIndex]) {
            continue;
        }

        const displayLine = currentLineIndex + 1;
        const line = lines[currentLineIndex];

        // Long lines (typically minified bundles): center a window around the error column so the
        // relevant code stays in the snippet. For ordinary lines we just take the leading slice.
        // trimmedColumnNumber is reported back so the UI can highlight the correct offset within the
        // sliced view rather than the now-meaningless original column number.
        if (line.length > maxSnippetLineLength) {
            if (columnNumber && columnNumber > maxSnippetLineLength / 2) {
                const start = columnNumber - Math.round(maxSnippetLineLength / 2);
                codeSnippet[displayLine] = line.slice(start, start + maxSnippetLineLength);

                if (displayLine === lineNumber) {
                    trimmedColumnNumber = Math.round(maxSnippetLineLength / 2);
                }

                continue;
            }

            codeSnippet[displayLine] = line.slice(0, maxSnippetLineLength) + '…';
            continue;
        }

        codeSnippet[displayLine] = line;
    }

    return { codeSnippet, trimmedColumnNumber };
}
