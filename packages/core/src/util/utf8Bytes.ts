// Shared by every envelope-sizing call site (Api.send, the log/trace envelope byte helpers). One
// encoder instance: constructing a TextEncoder per call is unnecessary overhead on hot paths like
// keepalive packing. Not part of the public util barrel: an internal sizing helper, not a seam.
const textEncoder = new TextEncoder();

/** UTF-8 byte length of `value`. */
export function utf8Bytes(value: string): number {
    return textEncoder.encode(value).length;
}
