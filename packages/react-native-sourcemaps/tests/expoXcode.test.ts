import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';
import xcode from 'xcode';

import { addUploadBuildPhase, FLARE_PHASE_NAME } from '../src/expoXcode';

const FIXTURE = resolve(__dirname, 'fixtures/project.pbxproj');

function parseFixture() {
    const project = xcode.project(FIXTURE);
    project.parseSync();
    return project;
}

function flarePhaseCount(project: ReturnType<typeof parseFixture>): number {
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    return Object.values(phases).filter(
        (phase: unknown) =>
            typeof phase === 'object' &&
            phase !== null &&
            typeof (phase as { name?: unknown }).name === 'string' &&
            (phase as { name: string }).name.replace(/^"|"$/g, '') === FLARE_PHASE_NAME,
    ).length;
}

describe('addUploadBuildPhase', () => {
    test('adds exactly one Flare upload phase', () => {
        const project = parseFixture();
        expect(flarePhaseCount(project)).toBe(0);
        addUploadBuildPhase(project, 'echo flare');
        expect(flarePhaseCount(project)).toBe(1);
    });

    test('is idempotent — a second call adds nothing', () => {
        const project = parseFixture();
        addUploadBuildPhase(project, 'echo flare');
        addUploadBuildPhase(project, 'echo flare');
        expect(flarePhaseCount(project)).toBe(1);
    });

    test('stores the shell script on the phase', () => {
        const project = parseFixture();
        addUploadBuildPhase(project, 'echo flare-marker');
        const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
        const serialised = JSON.stringify(phases);
        expect(serialised).toContain('flare-marker');
    });

    // The in-memory checks above don't prove the phase survives serialization to pbxproj text. The
    // xcode lib quote-escapes shellScript (`'"' + script.replace(/"/g,'\\"') + '"'`), and our real
    // script is multi-line with embedded quotes, exactly where that lib is fragile. writeSync()
    // exercises the serializer end to end.
    test('survives pbxproj serialization (writeSync)', () => {
        const project = parseFixture();
        addUploadBuildPhase(project, 'set -e\necho "flare-marker"\n');
        const pbxproj = project.writeSync();
        expect(pbxproj).toContain('Upload Flare sourcemaps');
        expect(pbxproj).toContain('flare-marker');
    });

    // "Based on dependency analysis" unchecked, no "ambiguous dependencies / runs on every build"
    // warning from Xcode. Serialized as `alwaysOutOfDate = 1`.
    test('marks the phase always-out-of-date so Xcode does not warn', () => {
        const project = parseFixture();
        addUploadBuildPhase(project, 'echo flare');
        expect(project.writeSync()).toContain('alwaysOutOfDate = 1');
    });
});
