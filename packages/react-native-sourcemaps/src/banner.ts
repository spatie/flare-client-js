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
 * The deliberately large failure banner. A one-line "failed to upload" is too easy
 * to miss in a long native-build log, so this is a bordered block surrounded by
 * blank lines. Real resolved values are interpolated into the re-run command so the
 * user can copy-paste it; unknown values show a labelled placeholder (in the
 * version-unset case `version` stays a placeholder — it is the value to supply).
 */
export function formatFailureBanner(info: FailureBannerInfo): string {
    const sourcemap = info.sourcemap ?? '<path-to-map>';
    const bundleFilename = info.bundleFilename ?? '<bundle-filename>';
    const version = info.version && info.version.length > 0 ? info.version : '<flare-sourcemap-version>';
    const apiKey = info.apiKey && info.apiKey.length > 0 ? info.apiKey : '<your-flare-api-key>';
    const endpointFlag = info.apiEndpoint ? ` --api-endpoint ${info.apiEndpoint}` : '';

    return [
        '',
        BORDER,
        '  FLARE SOURCEMAP UPLOAD FAILED',
        `  Reason: ${info.reason}`,
        '  Your release will report minified stack traces until the',
        '  sourcemap is uploaded. Re-run manually:',
        `    npx flare-rn-sourcemaps upload --sourcemap ${sourcemap} \\`,
        `      --bundle-filename ${bundleFilename} --version ${version} --api-key ${apiKey}${endpointFlag}`,
        BORDER,
        '',
    ].join('\n');
}

export function printFailureBanner(info: FailureBannerInfo): void {
    console.error(formatFailureBanner(info));
}
