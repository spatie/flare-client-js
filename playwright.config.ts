import { defineConfig } from '@playwright/test';

const FAKE_FLARE_PORT = process.env.FAKE_FLARE_PORT ?? '7765';
const FAKE_FLARE_INGEST_URL = `http://127.0.0.1:${FAKE_FLARE_PORT}/v1/errors`;

const sharedEnv = {
    VITE_FLARE_URL: FAKE_FLARE_INGEST_URL,
    FAKE_FLARE_PORT,
};

// Opt-in production-build suite. The default e2e run boots each playground with
// `vite dev` (React development build), which never emits the "Minified React
// error #NNN" strings the decode path keys on. The prod suite instead builds the
// React playground and serves it with `vite preview` so a genuine minified error
// is produced. Enable with E2E_PROD=1 (see the `test:e2e:prod` npm script).
const prod = !!process.env.E2E_PROD;

const REACT_PROD_PORT = 5191;

const devProjects = [
    {
        name: 'js',
        testMatch: /js\.spec\.ts$/,
        use: { baseURL: 'http://localhost:5180', browserName: 'chromium' as const },
    },
    {
        name: 'react',
        testMatch: /react\.spec\.ts$/,
        use: { baseURL: 'http://localhost:5181', browserName: 'chromium' as const },
    },
    {
        name: 'vue',
        testMatch: /vue\.spec\.ts$/,
        use: { baseURL: 'http://localhost:5182', browserName: 'chromium' as const },
    },
    {
        name: 'svelte',
        testMatch: /svelte\.spec\.ts$/,
        use: { baseURL: 'http://localhost:5183', browserName: 'chromium' as const },
    },
    {
        name: 'react-router',
        testMatch: /react-router\.spec\.ts$/,
        use: { baseURL: 'http://localhost:5185', browserName: 'chromium' as const },
    },
];

const prodProjects = [
    {
        name: 'react-prod',
        testMatch: /react-prod\.spec\.ts$/,
        use: { baseURL: `http://localhost:${REACT_PROD_PORT}`, browserName: 'chromium' as const },
    },
];

const devWebServers = [
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
    {
        command: 'npm run dev --workspace=@flareapp/playgrounds-react-router',
        url: 'http://localhost:5185',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-react-router' },
    },
];

// VITE_FLARE_URL is inlined into the bundle at build time, so it must be present
// for `vite build`, not just `vite preview`; the single shell command applies the
// env to both. --strictPort fails fast if the preview port is taken.
const prodWebServers = [
    {
        command:
            `npm run build --workspace=@flareapp/playgrounds-react && ` +
            `npm run preview --workspace=@flareapp/playgrounds-react -- --port ${REACT_PROD_PORT} --strictPort`,
        url: `http://localhost:${REACT_PROD_PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { ...sharedEnv, VITE_FLARE_KEY: 'test-key-react' },
    },
];

export default defineConfig({
    testDir: './e2e/specs',
    timeout: 30_000,
    retries: process.env.CI ? 2 : 0,
    fullyParallel: false,
    workers: 1,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',
    use: {
        trace: 'retain-on-failure',
    },
    projects: prod ? prodProjects : devProjects,
    webServer: prod ? prodWebServers : devWebServers,
});
