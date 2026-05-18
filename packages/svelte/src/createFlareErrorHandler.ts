import { convertToError, flare } from '@flareapp/js';
import ErrorStackParser from 'error-stack-parser';

import { contextToAttributes } from './contextToAttributes.js';
import { extractComponentInfo } from './extractComponentInfo.js';
import { getErrorOrigin } from './getErrorOrigin.js';
import { registerSvelteSdkIdentity } from './identify.js';
import type { FlareSvelteContext } from './types.js';

registerSvelteSdkIdentity();

export interface FlareErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    return async (rawError: unknown, _reset: () => void) => {
        const error = convertToError(rawError);

        options?.beforeEvaluate?.({ error });

        let frames: ErrorStackParser.StackFrame[] = [];
        try {
            frames = ErrorStackParser.parse(error);
        } catch {
            // unparseable stack
        }

        const { componentName, componentHierarchy } = extractComponentInfo(frames);
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
