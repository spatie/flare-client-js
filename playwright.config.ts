import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:5173',
    },
    projects: [
        {
            name: 'chromium',
            use: { browserName: 'chromium' },
        },
    ],
    webServer: {
        command: 'npm run playground',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        env: {
            VITE_FLARE_JS_KEY: 'test-key-js',
            VITE_FLARE_REACT_KEY: 'test-key-react',
            VITE_FLARE_VUE_KEY: 'test-key-vue',
        },
    },
});
