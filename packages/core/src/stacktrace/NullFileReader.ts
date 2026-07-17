import type { FileReader } from './fileReader';

/**
 * No-op `FileReader` returning `null` for every URL. Default for `Flare`'s `fileReader` param so `new Flare()` builds
 * reports without picking an environment; stack frames just omit source snippets. Consumer packages inject the real
 * ones: `@flareapp/js` a fetch-based reader, `@flareapp/node` a disk reader. The `read(url) -> Promise<string | null>`
 * interface lets the stack-trace builder treat all three the same (render on text, skip on null), so core needs no
 * environment checks.
 */
export class NullFileReader implements FileReader {
    read(_url: string): Promise<string | null> {
        return Promise.resolve(null);
    }
}
