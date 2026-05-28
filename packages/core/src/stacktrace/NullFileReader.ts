import type { FileReader } from './FileReader';

export class NullFileReader implements FileReader {
    read(_url: string): Promise<string | null> {
        return Promise.resolve(null);
    }
}
