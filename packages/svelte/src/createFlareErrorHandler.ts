import { convertToError, flare } from '@flareapp/js';
import ErrorStackParser from 'error-stack-parser';

import { contextToAttributes } from './contextToAttributes';
import { extractComponentInfo } from './extractComponentInfo';
import { getErrorOrigin } from './getErrorOrigin';
import { registerSvelteSdkIdentity } from './identify';
import type { FlareSvelteContext } from './types';

registerSvelteSdkIdentity();

export interface FlareErrorHandlerOptions {
    beforeEvaluate?: (params: { error: Error }) => void;
    beforeSubmit?: (params: { error: Error; context: FlareSvelteContext }) => FlareSvelteContext;
    afterSubmit?: (params: { error: Error; context: FlareSvelteContext }) => void;
}

export interface FlareErrorHandlerCallOptions {
    componentProps?: Record<string, unknown>;
}

export function createFlareErrorHandler(options?: FlareErrorHandlerOptions) {
    return async (rawError: unknown, _reset: () => void, callOptions?: FlareErrorHandlerCallOptions) => {
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
                ...(callOptions?.componentProps ? { componentProps: callOptions.componentProps } : {}),
            },
        };

        if (options?.beforeSubmit) {
            context = options.beforeSubmit({ error, context });
        }

        flare.reportSilently(error, contextToAttributes(context));

        options?.afterSubmit?.({ error, context });
    };
}
