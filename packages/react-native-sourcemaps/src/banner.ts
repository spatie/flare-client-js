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
 * Mask an API key for display in a build log, which CI commonly archives. A key
 * long enough to stay unguessable keeps a short head/tail so the user can still
 * recognise WHICH key it was; a short key is fully masked. Never returns the key
 * in full, so the secret cannot leak through the failure banner.
 */
export function maskApiKey(apiKey: string): string {
    if (apiKey.length <= 12) {
        return '*'.repeat(apiKey.length);
    }
    return `${apiKey.slice(0, 4)}${'*'.repeat(8)}${apiKey.slice(-4)}`;
}

/**
 * The deliberately large failure banner. A one-line "failed to upload" is too easy
 * to miss in a long native-build log, so this is a bordered block surrounded by
 * blank lines. Resolved values are interpolated into the re-run command so the
 * user can copy-paste it; unknown values show a labelled placeholder (in the
 * version-unset case `version` stays a placeholder — it is the value to supply).
 * The API key is the one exception: it is MASKED, never printed in full, because
 * this banner lands in the native build log.
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
