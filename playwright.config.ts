import { defineConfig } from '@playwright/test';

const FAKE_FLARE_PORT = process.env.FAKE_FLARE_PORT ?? '7765';
const FAKE_FLARE_URL = `http://127.0.0.1:${FAKE_FLARE_PORT}`;

const sharedEnv = {
    VITE_FLARE_URL: FAKE_FLARE_URL,
    FAKE_FLARE_PORT,
};

export default defineConfig({
    testDir: './e2e/specs',
    timeout: 30_000,
    retries: 0,
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',
    use: {
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'js',
            testMatch: /js\.spec\.ts$/,
            use: { baseURL: 'http://localhost:5180', browserName: 'chromium' },
        },
        {
            name: 'react',
            testMatch: /react\.spec\.ts$/,
            use: { baseURL: 'http://localhost:5181', browserName: 'chromium' },
        },
        {
            name: 'vue',
            testMatch: /vue\.spec\.ts$/,
            use: { baseURL: 'http://localhost:5182', browserName: 'chromium' },
        },
        {
            name: 'svelte',
            testMatch: /svelte\.spec\.ts$/,
            use: { baseURL: 'http://localhost:5183', browserName: 'chromium' },
        },
    ],
    webServer: [
        {
            command: 'npm run dev --workspace=@flareapp/playgrounds-js',
            url: 'http://localhost:5180',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-js' },
        },
        {
            command: 'npm run dev --workspace=@flareapp/playgrounds-react',
            url: 'http://localhost:5181',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-react' },
        },
        {
            command: 'npm run dev --workspace=@flareapp/playgrounds-vue',
            url: 'http://localhost:5182',
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-vue' },
        },
        {
            command: 'npm run dev --workspace=@flareapp/playgrounds-svelte',
            url: 'http://localhost:5183',
            reuseExistingServer: !process.env.CI,
            timeout: 90_000,
            env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-svelte' },
        },
    ],
});
