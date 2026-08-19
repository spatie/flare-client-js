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

// Every testMatch below is anchored on a path boundary (start of string or a preceding "/"), not just
// a suffix. A bare suffix regex silently matches more than its own spec file - e.g. /js\.spec\.ts$/ also
// matches nextjs.spec.ts, and /react\.spec\.ts$/ also matches preact.spec.ts - which runs that project's
// tests against the wrong playground instead of failing loudly. This fired for real once already (the
// js project was picking up nextjs.spec.ts); every project gets the same guard now, not just that one.

// Opt-in engine axis. The client is shipped to real browsers, so the suite has to be runnable on all
// three engines, not just the one Playwright defaults to. Default stays chromium: the full three-engine
// run takes about twelve minutes at workers: 1, which is too slow for the everyday loop.
// Only the dev projects take the axis. E2E_PROD swaps in prodProjects, which stays chromium-only, so
// E2E_ENGINES is ignored there.
const ENGINES = (process.env.E2E_ENGINES ?? 'chromium')
    .split(',')
    .map((engine) => engine.trim())
    .filter(Boolean) as Array<'chromium' | 'firefox' | 'webkit'>;

type Framework = { name: string; testMatch: RegExp; baseURL: string };

const frameworks: Framework[] = [
    { name: 'js', testMatch: /(^|\/)(js|vitals|frames)\.spec\.ts$/, baseURL: 'http://localhost:5180' },
    { name: 'react', testMatch: /(^|\/)react\.spec\.ts$/, baseURL: 'http://localhost:5181' },
    { name: 'vue', testMatch: /(^|\/)vue\.spec\.ts$/, baseURL: 'http://localhost:5182' },
    { name: 'svelte', testMatch: /(^|\/)svelte\.spec\.ts$/, baseURL: 'http://localhost:5183' },
    { name: 'react-router', testMatch: /(^|\/)react-router\.spec\.ts$/, baseURL: 'http://localhost:5185' },
    { name: 'nextjs', testMatch: /(^|\/)nextjs\.spec\.ts$/, baseURL: 'http://localhost:5184' },
];

// Chromium keeps the bare project name so `--project=svelte` and the commands in CLAUDE.md keep working.
const devProjects = ENGINES.flatMap((browserName) =>
    frameworks.map((framework) => ({
        name: browserName === 'chromium' ? framework.name : `${framework.name}-${browserName}`,
        testMatch: framework.testMatch,
        use: { baseURL: framework.baseURL, browserName },
    })),
);

const prodProjects = [
    {
        name: 'react-prod',
        testMatch: /(^|\/)react-prod\.spec\.ts$/,
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
    // Can't reuse sharedEnv: that carries VITE_FLARE_URL, which Next ignores. It reads
    // NEXT_PUBLIC_FLARE_URL / NEXT_PUBLIC_FLARE_KEY instead (see playgrounds/nextjs/src/flare.ts).
    // Timeout is higher than the Vite playgrounds because next dev compiles a route on first request.
    {
        command: 'npm run dev --workspace=@flareapp/playgrounds-nextjs',
        url: 'http://localhost:5184',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
            FAKE_FLARE_PORT,
            NEXT_PUBLIC_FLARE_URL: FAKE_FLARE_INGEST_URL,
            NEXT_PUBLIC_FLARE_KEY: 'test-key-nextjs',
        },
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
