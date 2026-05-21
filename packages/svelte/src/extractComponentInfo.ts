import type ErrorStackParser from 'error-stack-parser';

import { lookupComponentTree, type ComponentTreeNode } from './componentTree.js';

interface ComponentInfo {
    componentName: string | null;
    componentHierarchy: string[];
}

export function extractComponentInfo(
    frames: ErrorStackParser.StackFrame[],
    ancestor?: ComponentTreeNode | null
): ComponentInfo {
    const svelteFrames = frames.filter((frame) => frame.fileName && frame.fileName.includes('.svelte'));

    if (svelteFrames.length === 0) {
        return { componentName: null, componentHierarchy: [] };
    }

    // Try the preprocessor-based component tree first.
    // Walk each .svelte frame until we find one that was registered.
    for (const frame of svelteFrames) {
        if (!frame.fileName) continue;

        const treeHierarchy = lookupComponentTree(frame.fileName, ancestor);

        if (treeHierarchy.length > 0) {
            return {
                componentName: treeHierarchy[0],
                componentHierarchy: treeHierarchy,
            };
        }
    }

    // Fallback: extract names from stack frames only (no preprocessor).
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
