import { safeClone } from './safeClone';

/**
 * JSON.stringify hardened for untrusted glow / addContext data: cycles become "[Circular]", a BigInt
 * its decimal string, and a throwing getter "[Getter threw]", each of which would otherwise throw and
 * drop the whole report.
 */
export function flatJsonStringify(json: object): string {
    return JSON.stringify(safeClone(json, { mode: 'json' }));
}
