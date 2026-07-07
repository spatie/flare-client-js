export type FailureBannerInfo = {
    /** Human-readable reason shown after "Reason:". */
    reason: string;
    /** Resolved sourcemap path, interpolated into the recovery command. */
    sourcemap?: string;
    /** Resolved relative_filename, interpolated into the recovery command. */
    bundleFilename?: string;
    /** Resolved version, interpolated into the recovery command. */
    version?: string;
    /** Resolved API key, interpolated into the recovery command. */
    apiKey?: string;
    /** Resolved API endpoint; only included in the recovery command when set (custom endpoint). */
    apiEndpoint?: string;
};

const BORDER = '='.repeat(60);

/**
 * Mask an API key for display in a build log (CI commonly archives these). Long keys keep a short
 * head/tail hint so the user can recognise which key it was; short keys are fully masked. Never
 * returns the key in full.
 */
export function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 12) {
        return '*'.repeat(apiKey.length);
    }
    return `${apiKey.slice(0, 4)}${'*'.repeat(8)}${apiKey.slice(-4)}`;
}

/**
 * Deliberately large failure banner (a one-line "failed to upload" is too easy to miss in a native
 * build log). Resolved values are interpolated into a copy-pasteable re-run command; unknown values
 * show a labelled placeholder. The API key is masked, never printed in full, since this lands in the
 * build log.
 */
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
