export function randomHex(bytes: number): string {
    const randomBytes = new Uint8Array(bytes);
    const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
        cryptoApi.getRandomValues(randomBytes);
    } else {
        for (let i = 0; i < bytes; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256);
        }
    }
    // W3C: all-zeroes forbidden
    if (randomBytes.every((b) => b === 0)) {
        randomBytes[bytes - 1] = 1;
    }
    let out = '';
    for (let i = 0; i < bytes; i++) {
        out += randomBytes[i].toString(16).padStart(2, '0');
    }
    return out;
}

export const traceId = (): string => randomHex(16); // 32 hex chars

export const spanId = (): string => randomHex(8); // 16 hex chars
