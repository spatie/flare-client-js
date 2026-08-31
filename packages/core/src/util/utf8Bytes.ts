// Shared by every envelope-sizing call site so hot paths like keepalive packing do not build a new
// TextEncoder per call. Not part of the public util barrel: an internal sizing helper, not a seam.
const textEncoder = new TextEncoder();

// UTF-8 byte length of `value`.
export function utf8Bytes(value: string): number {
    return textEncoder.encode(value).length;
}
