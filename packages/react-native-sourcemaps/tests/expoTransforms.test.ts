import { describe, expect, test } from 'vitest';

import {
    addFlareGradleApply,
    addSourcemapFileEnv,
    ensureGitignored,
    flareJsonContents,
    flareXcodeShellScript,
    toPosixRelative,
} from '../src/expoTransforms';

describe('flareJsonContents', () => {
    test('serialises the provided props', () => {
        expect(JSON.parse(flareJsonContents({ apiKey: 'k', apiEndpoint: 'https://e.test' }))).toEqual({
            apiKey: 'k',
            apiEndpoint: 'https://e.test',
        });
    });

    test('omits absent keys', () => {
        expect(JSON.parse(flareJsonContents({ apiKey: 'k' }))).toEqual({ apiKey: 'k' });
        expect(JSON.parse(flareJsonContents({}))).toEqual({});
    });

    test('ends with a trailing newline', () => {
        expect(flareJsonContents({})).toMatch(/\n$/);
    });
});

describe('addFlareGradleApply', () => {
    test('appends the apply line', () => {
        const out = addFlareGradleApply('apply plugin: "com.android.application"\n', '../../x/flare.gradle');
        expect(out).toContain('apply from: "../../x/flare.gradle"');
        expect(out.startsWith('apply plugin:')).toBe(true);
    });

    test('is idempotent', () => {
        const once = addFlareGradleApply('content\n', '../../x/flare.gradle');
        const twice = addFlareGradleApply(once, '../../x/flare.gradle');
        expect(twice).toBe(once);
    });
});

describe('addSourcemapFileEnv', () => {
    test('appends the SOURCEMAP_FILE export to empty/missing input', () => {
        expect(addSourcemapFileEnv('')).toContain('export SOURCEMAP_FILE="$TARGET_TEMP_DIR/main.jsbundle.map"');
    });

    test('is idempotent and respects a pre-existing SOURCEMAP_FILE', () => {
        const once = addSourcemapFileEnv('export NODE_BINARY=node\n');
        expect(addSourcemapFileEnv(once)).toBe(once);
        expect(addSourcemapFileEnv('export SOURCEMAP_FILE=/custom\n')).toBe('export SOURCEMAP_FILE=/custom\n');
        expect(addSourcemapFileEnv('SOURCEMAP_FILE=/custom\n')).toBe('SOURCEMAP_FILE=/custom\n');
    });

    test('injects past a commented-out SOURCEMAP_FILE line', () => {
        const out = addSourcemapFileEnv('# export SOURCEMAP_FILE=/old\n');
        expect(out).toContain('export SOURCEMAP_FILE="$TARGET_TEMP_DIR/main.jsbundle.map"');
    });
});

describe('ensureGitignored', () => {
    test('appends flare.json once', () => {
        const once = ensureGitignored('node_modules/\n');
        expect(once).toContain('flare.json');
        expect(ensureGitignored(once)).toBe(once);
    });

    test('does not duplicate an existing entry', () => {
        expect(ensureGitignored('flare.json\n')).toBe('flare.json\n');
    });
});

describe('flareXcodeShellScript', () => {
    test('emits the with-environment wrapped invocation', () => {
        const script = flareXcodeShellScript(
            '../node_modules/react-native/scripts/xcode/with-environment.sh',
            '../node_modules/@flareapp/x/scripts/flare-xcode.sh',
        );
        expect(script).toContain('WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"');
        expect(script).toContain('FLARE_XCODE="../node_modules/@flareapp/x/scripts/flare-xcode.sh"');
        expect(script).toContain('/bin/sh -c "$WITH_ENVIRONMENT $FLARE_XCODE"');
        expect(script).toContain('set -e');
    });
});

describe('toPosixRelative', () => {
    test('returns a forward-slash relative path', () => {
        expect(toPosixRelative('/a/b/ios', '/a/b/node_modules/x/y.sh')).toBe('../node_modules/x/y.sh');
    });
});
