/**
 * Framework names the Flare backend recognises. Wire format, so the values never change: they ship as
 * `flare.framework.name` and (lowercased) as `context.custom.framework`.
 *
 * `Js` and `Node` are the base SDKs' fallback claim, overwritten when a framework package tags its
 * own name. `NodeElectron` is an Electron main process; its renderers report their own.
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
