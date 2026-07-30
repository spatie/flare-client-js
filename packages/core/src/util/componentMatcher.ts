import { withoutStatefulFlags } from './statelessRegExp';

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

    const patterns = option
        .filter((entry): entry is RegExp => entry instanceof RegExp)
        .map((pattern) => withoutStatefulFlags(pattern));

    return (name: string): boolean => names.has(name) || patterns.some((pattern) => pattern.test(name));
}
