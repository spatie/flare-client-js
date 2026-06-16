export const CLIENT_VERSION =
    typeof process !== 'undefined' && typeof process.env?.FLARE_ELECTRON_CLIENT_VERSION !== 'undefined'
        ? process.env.FLARE_ELECTRON_CLIENT_VERSION
        : '?';
