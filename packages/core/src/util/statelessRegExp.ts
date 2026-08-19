/**
 * A `/g` or `/y` regex carries `lastIndex` between `test()` calls, so every other call misses. Returns
 * a copy rather than mutating what the caller handed us.
 */
export function withoutStatefulFlags(pattern: RegExp): RegExp;
export function withoutStatefulFlags(pattern: RegExp | undefined): RegExp | undefined;
export function withoutStatefulFlags(pattern?: RegExp): RegExp | undefined {
    if (!pattern) {
        return undefined;
    }

    return pattern.global || pattern.sticky ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : pattern;
}
