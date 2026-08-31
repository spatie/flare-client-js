/**
 * Framework names the Flare backend recognizes. Wire format: these values never change, since they
 * ship as `flare.framework.name` and (lowercased) as `context.custom.framework`.
 *
 * `Js` and `Node` are fallback claims from the base SDKs, overwritten when a framework package sets
 * its own name. `NodeElectron` is the Electron main process; renderers report their own name.
 */
export const FrameworkName = {
    Js: 'js',
    Node: 'node',
    NodeElectron: 'node-electron',
    React: 'react',
    Vue: 'vue',
    Svelte: 'svelte',
    SvelteKit: 'sveltekit',
    ReactNative: 'react-native',
} as const;

export type FrameworkName = (typeof FrameworkName)[keyof typeof FrameworkName];
