import { CLIENT_VERSION } from '../env';

export function assert(value: any, message: string, debug: boolean) {
    if (debug && !value) {
        console.error(`Flare JavaScript client v${CLIENT_VERSION}: ${message}`);
    }

    return !!value;
}
