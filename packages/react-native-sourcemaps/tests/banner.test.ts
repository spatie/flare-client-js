import { describe, expect, test } from 'vitest';

import { formatFailureBanner } from '../src/banner';

describe('formatFailureBanner', () => {
    test('renders a bordered banner with the reason', () => {
        const banner = formatFailureBanner({ reason: 'boom' });
        expect(banner).toContain('FLARE SOURCEMAP UPLOAD FAILED');
        expect(banner).toContain('Reason: boom');
        expect(banner).toContain('='.repeat(60));
    });

    test('starts and ends with a blank line so it stands out in CI', () => {
        const lines = formatFailureBanner({ reason: 'x' }).split('\n');
        expect(lines[0]).toBe('');
        expect(lines[lines.length - 1]).toBe('');
    });

    test('interpolates the real resolved values into the recovery command', () => {
        const banner = formatFailureBanner({
            reason: 'x',
            sourcemap: '/build/main.jsbundle.map',
            bundleFilename: 'main.jsbundle',
            version: 'sha123',
            apiKey: 'real-key',
        });
        expect(banner).toContain('--sourcemap /build/main.jsbundle.map');
        expect(banner).toContain('--bundle-filename main.jsbundle');
        expect(banner).toContain('--version sha123');
        expect(banner).toContain('--api-key real-key');
    });

    test('falls back to labelled placeholders when values are unknown', () => {
        const banner = formatFailureBanner({ reason: 'no key' });
        expect(banner).toContain('<path-to-map>');
        expect(banner).toContain('<bundle-filename>');
        expect(banner).toContain('<flare-sourcemap-version>');
        expect(banner).toContain('<your-flare-api-key>');
    });

    test('treats empty-string version and apiKey as unknown (placeholders)', () => {
        const banner = formatFailureBanner({ reason: 'x', version: '', apiKey: '' });
        expect(banner).toContain('<flare-sourcemap-version>');
        expect(banner).toContain('<your-flare-api-key>');
    });
});
