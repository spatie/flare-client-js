import { withFlareSourcemaps } from '@flareapp/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ['@flareapp/playgrounds-shared'],
};

export default withFlareSourcemaps(nextConfig, {
    apiKey: process.env.FLARE_KEY || 'test-key-nextjs',
    apiEndpoint: process.env.FLARE_URL || 'https://flareapp.io/api/sourcemaps',
    removeSourcemaps: false,
    runInDevelopment: false,
});
