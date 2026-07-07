import type { MinifiedReactError } from './types';

const NUMBER_PATTERN = /Minified React error #(\d+)/;
const ARG_PATTERN = /args\[\]=([^&\s]*)/g;
const URL_PATTERN = /(https?:\/\/\S+)/;

// decodeURIComponent throws on malformed percent escapes (e.g. "%E0%A4%A"). This runs while the
// boundary/handler is already processing an error, so a throw must not escape; fall back to raw.
function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export function parseMinifiedReactError(error: Error): MinifiedReactError | null {
    const message = error?.message;

    if (!message) {
        return null;
    }

    const numberMatch = message.match(NUMBER_PATTERN);

    if (!numberMatch) {
        return null;
    }

    const args: string[] = [];

    for (const match of message.matchAll(ARG_PATTERN)) {
        args.push(safeDecode(match[1]));
    }

    const urlMatch = message.match(URL_PATTERN);

    return {
        number: Number(numberMatch[1]),
        args,
        url: urlMatch ? urlMatch[1] : null,
    };
}
