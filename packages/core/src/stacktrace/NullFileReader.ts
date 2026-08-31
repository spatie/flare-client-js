import type { FileReader } from './fileReader';

/**
 * No-op `FileReader` returning `null` for every URL. Default for `Flare`'s `fileReader` param, so
 * `new Flare()` builds reports without picking an environment; stack frames just omit source snippets.
 * `@flareapp/js` and `@flareapp/node` inject a real fetch- or disk-based reader instead.
 */
export class NullFileReader implements FileReader {
    read(_url: string): Promise<string | null> {
        return Promise.resolve(null);
    }
}
