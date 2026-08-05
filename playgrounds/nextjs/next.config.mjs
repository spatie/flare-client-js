import { withFlareSourcemaps } from '@flareapp/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ['@flareapp/playgrounds-shared'],
};

// Same opt-in as the vite playgrounds (see playgrounds/shared/src/vite/flareSourcemaps.ts): upload when
// the e2e run points us at the fake Flare server, or when FLARE_UPLOAD_SOURCEMAPS=1 is exported. The rule
// is repeated here instead of imported because Next loads this config with plain node, which cannot read
// the TypeScript helper.
const ingestUrl = process.env.NEXT_PUBLIC_FLARE_URL;
const uploadSourcemaps = Boolean(ingestUrl) || process.env.FLARE_UPLOAD_SOURCEMAPS === '1';

// Wrapping is skipped entirely when opted out, because the wrapper also force-enables
// productionBrowserSourceMaps.
export default uploadSourcemaps
    ? withFlareSourcemaps(nextConfig, {
          apiKey: process.env.NEXT_PUBLIC_FLARE_KEY || 'test-key-nextjs',
          // NEXT_PUBLIC_FLARE_URL points at the error ingest path, so keep only its origin.
          apiEndpoint: ingestUrl ? new URL('/api/sourcemaps', ingestUrl).href : 'https://flareapp.io/api/sourcemaps',
          removeSourcemaps: false,
          runInDevelopment: false,
      })
    : nextConfig;
