import { assert } from './assert';

export function assertKey(key: unknown, debug: boolean): boolean {
    return assert(
        key,
        'The client was not yet initialised with an API key. ' +
            "Run client.light('<flare-project-key>') when you initialise your app. " +
            "If you are running in dev mode and didn't run the light command on purpose, you can ignore this error.",
        debug,
    );
}
