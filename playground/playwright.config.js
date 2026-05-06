import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 30_000,
    use: {
        headless: true,
    },
    webServer: [
        {
            command: 'npm run dev',
            cwd: './js',
            port: 3001,
            reuseExistingServer: true,
        },
        {
            command: 'npm run dev',
            cwd: './react',
            port: 3002,
            reuseExistingServer: true,
        },
        {
            command: 'npm run dev',
            cwd: './vue',
            port: 3003,
            reuseExistingServer: true,
        },
    ],
});
