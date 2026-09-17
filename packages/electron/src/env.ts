// tsdown inlines the member access at build time. A `typeof process` guard or a local `process`
// declaration survives the build and reads '?' in browsers. Under vitest it reads '?'.
export const CLIENT_VERSION: string = process.env.FLARE_ELECTRON_CLIENT_VERSION ?? '?';
