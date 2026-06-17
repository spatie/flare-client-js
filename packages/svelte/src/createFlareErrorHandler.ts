import { convertToError } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';
import ErrorStackParser from 'error-stack-parser';

import type { ComponentTreeNode } from './componentTree.js';
import { contextToAttributes } from './contextToAttributes.js';
import { extractComponentInfo } from './extractComponentInfo.js';
import { getErrorOrigin } from './getErrorOrigin.js';
import { tagSvelteFramework } from './identify.js';
import { resolveFlare } from './resolveFlare.js';
import type { FlareSvelteContext } from './types.js';

export interface FlareErrorHandlerOptions {
    flare?: Flare;
    ancestor?: ComponentTreeNode | null;
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    const flare = resolveFlare(options?.flare);
    tagSvelteFramework(flare);

    return async (rawError: unknown, _reset: () => void) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error });

        let frames: ErrorStackParser.StackFrame[] = [];
        try {
            frames = ErrorStackParser.parse(error);
        } catch {
            // unparseable stack
        }

        const { componentName, componentHierarchy } = extractComponentInfo(frames, options?.ancestor);
        const errorOrigin = getErrorOrigin(frames);

        let context: FlareSvelteContext = {
            svelte: {
                componentName,
                componentHierarchy,
                errorOrigin,
            },
        };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, context });
        }

        flare.reportSilently(error, contextToAttributes(context));

        options?.afterSubmit?.({ error, context });
    };
}
