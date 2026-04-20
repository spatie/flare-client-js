export function convertToError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    if (typeof error === 'string') {
        return new Error(error);
    }

    if (error === null || error === undefined || typeof error !== 'object') {
        return new Error(String(error));
    }

    try {
        const serialized = JSON.stringify(error);

        return new Error(serialized === undefined ? String(error) : serialized);
    } catch {
        return new Error(String(error));
    }
}
