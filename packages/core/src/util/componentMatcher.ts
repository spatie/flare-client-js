/** What a framework integration's `profileComponents` option accepts. */
export type ProfileComponentsOption = boolean | (string | RegExp)[];

/**
 * Built once so a mount costs one name resolution and one match. Strings match exactly, regexes by
 * `test()`.
 */
export function createComponentMatcher(option: ProfileComponentsOption): (name: string) => boolean {
    if (option === true) {
        return () => true;
    }
    if (!option || option.length === 0) {
        return () => false;
    }

    const names = new Set(option.filter((entry): entry is string => typeof entry === 'string'));

    // A /g/ or /y/ regex carries lastIndex between calls, so every other test() would miss. Copy
    // rather than mutate what the caller handed us.
    const patterns = option
        .filter((entry): entry is RegExp => entry instanceof RegExp)
        .map((pattern) =>
            pattern.global || pattern.sticky ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')) : pattern,
        );

    return (name: string): boolean => names.has(name) || patterns.some((pattern) => pattern.test(name));
}
