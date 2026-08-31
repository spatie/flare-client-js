export type FailureBannerInfo = {
    reason: string;
    // Resolved values, interpolated into the recovery command the banner prints. Anything unset shows a labelled placeholder instead.
    sourcemap?: string;
    bundleFilename?: string;
    version?: string;
    apiKey?: string;
    // Only included in the recovery command when set, i.e. a custom endpoint.
    apiEndpoint?: string;
};

const BORDER = '='.repeat(60);

// CI commonly archives build logs. A long key keeps a head/tail hint so it stays recognizable; a short one
// is masked completely. Never returns the key in full.
export function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 12) {
        return '*'.repeat(apiKey.length);
    }
    return `${apiKey.slice(0, 4)}${'*'.repeat(8)}${apiKey.slice(-4)}`;
}

// Deliberately large: a one-line "failed to upload" is too easy to miss in a native build log.
export function formatFailureBanner(info: FailureBannerInfo): string {
    const sourcemap = info.sourcemap ?? '<path-to-map>';
    const bundleFilename = info.bundleFilename ?? '<bundle-filename>';
    const version = info.version && info.version.length > 0 ? info.version : '<flare-sourcemap-version>';
    const hasApiKey = !!(info.apiKey && info.apiKey.length > 0);
    const apiKey = hasApiKey ? maskApiKey(info.apiKey as string) : '<your-flare-api-key>';
    const endpointFlag = info.apiEndpoint ? ` --api-endpoint ${info.apiEndpoint}` : '';

    const lines = [
        '',
        BORDER,
        '  FLARE SOURCEMAP UPLOAD FAILED',
        `  Reason: ${info.reason}`,
        '  Your release will report minified stack traces until the',
        '  sourcemap is uploaded. Re-run manually:',
        `    npx flare-rn-sourcemaps upload --sourcemap ${sourcemap} \\`,
        `      --bundle-filename ${bundleFilename} --version ${version} --api-key ${apiKey}${endpointFlag}`,
    ];
    if (hasApiKey) {
        lines.push(
            '  (the --api-key above is masked; pass your full Flare key, or set FLARE_API_KEY, when re-running)',
        );
    }
    lines.push(BORDER, '');

    return lines.join('\n');
}

export function printFailureBanner(info: FailureBannerInfo): void {
    console.error(formatFailureBanner(info));
}
