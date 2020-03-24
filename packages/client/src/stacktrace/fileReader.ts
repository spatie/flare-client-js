const cachedFiles: { [key: string]: string } = {};

type CodeSnippet = {
    [key: number]: string;
};

type ReaderResponse = {
    codeSnippet: CodeSnippet;
    trimmedColumnNumber: number | null;
};

const failedResponse = { codeSnippet: { 0: 'Could not read from file' }, trimmedColumnNumber: null };

export function getCodeSnippet(url?: string, lineNumber?: number, columnNumber?: number): Promise<ReaderResponse> {
    return new Promise(resolve => {
        if (!url || !lineNumber) {
            return resolve(failedResponse);
        }

        readFile(url).then(fileText => {
            if (!fileText) {
                return resolve(failedResponse);
            }

            return resolve(readLinesFromFile(fileText, lineNumber, columnNumber));
        });
    });
}

function readFile(url: string): Promise<string | null> {
    return new Promise(resolve => {
        const rawFile = new XMLHttpRequest();

        if (cachedFiles[url]) {
            return resolve(cachedFiles[url]);
        }

        rawFile.open('GET', url, false);
        rawFile.onreadystatechange = () => {
            if (rawFile.readyState === 4) {
                if (rawFile.status === 200 || rawFile.status == 0) {
                    cachedFiles[url] = rawFile.responseText;

                    return resolve(rawFile.responseText);
                }
            }

            return resolve(null);
        };

        try {
            rawFile.send(null);
        } catch (error) {
            return resolve(null);
        }
    });
}

function readLinesFromFile(
    fileText: string,
    lineNumber: number,
    columnNumber?: number,
    maxSnippetLineLength = 1000
): ReaderResponse {
    const codeSnippet: CodeSnippet = {};
    let trimmedColumnNumber = null;

    const lines = fileText.split('\n');

    for (let i = -20; i <= 20; i++) {
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
