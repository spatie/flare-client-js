import type { FileReader } from './fileReader';

/**
 * No-op `FileReader` that returns `null` for every URL it is asked to read.
 *
 * Used as the default for `Flare`'s `fileReader` constructor parameter so the
 * class is usable without picking a side: instantiated bare (`new Flare()`),
 * reports still build, but stack frames omit source-code snippets — which is
 * the correct, safe behavior in an environment we know nothing about.
 *
 * The two real implementations live in the consumer packages and take their
 * place once the right environment is established:
 *
 * - `@flareapp/js` injects `FetchFileReader`, which `fetch()`s source maps
 *   and original files over HTTP for browser stack frames.
 * - `@flareapp/node` injects `DiskFileReader`, which reads files from disk
 *   via `node:fs/promises` for server stack frames.
 *
 * The interface (`read(url) -> Promise<string | null>`) lets the stack-trace
 * builder treat all three the same way: ask for a URL, render the snippet
 * when text comes back, gracefully skip it when `null` does. No environment
 * checks anywhere in core.
 */
export class NullFileReader implements FileReader {
    read(_url: string): Promise<string | null> {
        return Promise.resolve(null);
    }
}
