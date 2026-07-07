export function randomHex(bytes: number): string {
    const buf = new Uint8Array(bytes);
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === 'function') {
        c.getRandomValues(buf);
    } else {
        for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    if (buf.every((b) => b === 0)) buf[bytes - 1] = 1; // W3C: all-zeroes forbidden
    let out = '';
    for (let i = 0; i < bytes; i++) out += buf[i].toString(16).padStart(2, '0');
    return out;
}

export const traceId = (): string => randomHex(16); // 32 hex chars

export const spanId = (): string => randomHex(8); // 16 hex chars
