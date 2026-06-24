// Copy to flare.config.ts (git-ignored) and fill in your project key.
//
// Reports go to `ingestUrl`. Default is real Flare ingress. To use the local
// e2e fake-flare-server instead, set ingestUrl to your Mac's LAN IP (NOT
// localhost — a simulator/device resolves localhost to itself):
//   ingestUrl: 'http://192.168.x.x:7765/api/reports'
export const config = {
    key: 'YOUR-FLARE-PROJECT-KEY',
    ingestUrl: 'https://ingress.flareapp.io/v1/errors',
};

export const isConfigured = config.key !== 'YOUR-FLARE-PROJECT-KEY' && config.key.length > 0;
