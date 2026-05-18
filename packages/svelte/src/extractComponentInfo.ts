import type ErrorStackParser from 'error-stack-parser';

interface ComponentInfo {
    componentName: string | null;
    componentHierarchy: string[];
}

/**
 * Extracts Svelte component names from an error's stack frames by filtering for `.svelte`
 * filenames. The first match is `componentName`, the full deduplicated list is the hierarchy.
 * Only captures components present in the call stack at throw time, so parent components
 * may be missing for synchronous init errors.
 */
export function extractComponentInfo(frames: ErrorStackParser.StackFrame[]): ComponentInfo {
    const svelteFrames = frames.filter((frame) => frame.fileName && frame.fileName.includes('.svelte'));

    if (svelteFrames.length === 0) {
        return { componentName: null, componentHierarchy: [] };
    }

    const names: string[] = [];

    for (const frame of svelteFrames) {
        const name = extractName(frame);

        if (name && name !== names[names.length - 1]) {
            names.push(name);
        }
    }

    return {
        componentName: names[0] ?? null,
        componentHierarchy: names,
    };
}

/** Prefers functionName (dev builds) over fileName (prod builds where names are mangled). */
function extractName(frame: ErrorStackParser.StackFrame): string | null {
    if (frame.functionName && frame.functionName !== '<anonymous>' && !frame.functionName.includes('.')) {
        return frame.functionName;
    }

    if (frame.fileName) {
        const match = frame.fileName.match(/([^/]+)\.svelte/);
        return match?.[1] ?? null;
    }

    return null;
}
