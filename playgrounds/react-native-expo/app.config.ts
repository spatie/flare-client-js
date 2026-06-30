import type { ExpoConfig } from 'expo/config';

// Resolved by the Expo CLI, which auto-loads .env / .env.local — so the Flare key
// never lives in a committed file. The same key feeds two consumers:
//   - the sourcemaps config plugin -> build-time flare.json (sourcemap upload)
//   - `extra` -> read at runtime via expo-constants to boot the SDK
// The report ingest URL is independent of the plugin's sourcemap-upload endpoint.
const flareApiKey = process.env.FLARE_API_KEY ?? '';
const flareIngestUrl = process.env.FLARE_INGEST_URL ?? 'https://ingress.flareapp.io/v1/errors';

const config: ExpoConfig = {
    name: 'react-native-expo',
    slug: 'react-native-expo',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    plugins: [['@flareapp/react-native-sourcemaps/expo', { apiKey: flareApiKey }]],
    ios: {
        supportsTablet: true,
        bundleIdentifier: 'com.anonymous.react-native-expo',
    },
    android: {
        adaptiveIcon: {
            backgroundColor: '#E6F4FE',
            foregroundImage: './assets/android-icon-foreground.png',
            backgroundImage: './assets/android-icon-background.png',
            monochromeImage: './assets/android-icon-monochrome.png',
        },
        predictiveBackGestureEnabled: false,
        package: 'com.anonymous.reactnativeexpo',
    },
    web: {
        favicon: './assets/favicon.png',
    },
    extra: {
        flareApiKey,
        flareIngestUrl,
    },
};

export default config;
