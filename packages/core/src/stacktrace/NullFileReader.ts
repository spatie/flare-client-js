import type { FileReader } from './fileReader';

export class NullFileReader implements FileReader {
    read(_url: string): Promise<string | null> {
        return Promise.resolve(null);
    }
}
