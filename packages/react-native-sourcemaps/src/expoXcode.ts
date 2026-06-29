import type { XcodeProject } from '@expo/config-plugins';

export const FLARE_PHASE_NAME = 'Upload Flare sourcemaps';

// The `xcode` runtime API (mutated in place) is broader than the published type, so
// access the parts we need through a minimal structural view.
type ShellScriptPhase = { name?: string; alwaysOutOfDate?: number };
type XcodeInternal = {
    hash: { project: { objects: Record<string, Record<string, ShellScriptPhase | string>> } };
    addBuildPhase: (
        filePaths: string[],
        isa: string,
        comment: string,
        target: string | null,
        options: { shellPath: string; shellScript: string },
    ) => { buildPhase: ShellScriptPhase };
};

/**
 * Append an "Upload Flare sourcemaps" shell-script phase to the app target. The phase
 * is APPENDED (so it always runs after the JS bundle phase, whatever that phase is
 * named or wherever it sits across Expo SDKs). Idempotency guard: skip if a phase with
 * our name already exists. Note this mutates `project` in place (the `xcode` lib's
 * contract) and returns the same instance for convenience.
 */
export function addUploadBuildPhase(project: XcodeProject, shellScript: string): XcodeProject {
    const internal = project as unknown as XcodeInternal;
    const phases = internal.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    const alreadyPresent = Object.values(phases).some(
        (phase) =>
            typeof phase === 'object' &&
            phase !== null &&
            typeof phase.name === 'string' &&
            phase.name.replace(/^"|"$/g, '') === FLARE_PHASE_NAME,
    );
    if (alreadyPresent) {
        return project;
    }

    const { buildPhase } = internal.addBuildPhase([], 'PBXShellScriptBuildPhase', FLARE_PHASE_NAME, null, {
        shellPath: '/bin/sh',
        shellScript,
    });
    // Uncheck "Based on dependency analysis": the phase has no input/output files, so
    // without this Xcode warns ("ambiguous dependencies ... runs on every build") on
    // every build. We *want* it to run every release build — it self-skips when there
    // is no map, no key, or no version.
    buildPhase.alwaysOutOfDate = 1;
    return project;
}
