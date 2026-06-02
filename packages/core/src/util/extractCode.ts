const MAX_CODE_LENGTH = 64;

export function extractCode(error: Error): string | undefined {
    const code = (error as { code?: unknown }).code;

    if (typeof code !== 'string' || code.length === 0) {
        return undefined;
    }

    return code.slice(0, MAX_CODE_LENGTH);
}
