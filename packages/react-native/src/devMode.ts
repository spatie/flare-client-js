// `__DEV__` is a React Native global (true in dev bundles, false and
// dead-code-eliminated in production). Declared here for the type-checker;
// guarded with `typeof` so non-RN environments (e.g. ESM test runners) are safe.
declare const __DEV__: boolean | undefined;

/** True only in a React Native dev bundle. Safe (false) everywhere else. */
export function inDevMode(): boolean {
    return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}
