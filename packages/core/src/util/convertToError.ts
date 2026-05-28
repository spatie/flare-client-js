export function convertToError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    if (typeof error === 'string') {
        return new Error(error);
    }
    if (typeof error === 'object' && error !== null) {
        const obj = error as Record<string, unknown>;
        const message = typeof obj.message === 'string' ? obj.message : String(error);
        const converted = new Error(message);
        if (typeof obj.stack === 'string') {
            converted.stack = obj.stack;
        }
        if (typeof obj.name === 'string') {
            converted.name = obj.name;
        }
        return converted;
    }

    return new Error(String(error));
}
