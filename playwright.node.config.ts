import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e/node-frameworks',
    timeout: 30_000,
    retries: 0,
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',
    projects: [
        {
            name: 'node-frameworks',
            testMatch: /context\.spec\.ts$/,
        },
    ],
});
