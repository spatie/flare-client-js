import { convertToError } from '@flareapp/core';
import type { Flare } from '@flareapp/js/browser';

import { buildReactContext } from './buildReactContext';
import { contextToAttributes } from './contextToAttributes';
import { tagReactFramework } from './identify';
import { parseMinifiedReactError } from './parseMinifiedReactError';
import { resolveFlare } from './resolveFlare';
import { FlareReactContext } from './types';

export type FlareReactErrorHandlerCallback = (error: unknown, errorInfo: { componentStack?: string }) => void;

export type FlareReactErrorHandlerOptions = {
    flare?: Flare;
    beforeEvaluate?: (params: { error: Error; errorInfo: { componentStack?: string } }) => void;
    beforeSubmit?: (params: {
        error: Error;
        errorInfo: { componentStack?: string };
        context: FlareReactContext;
    }) => FlareReactContext;
    afterSubmit?: (params: {
        error: Error;
        errorInfo: { componentStack?: string };
        context: FlareReactContext;
    }) => void;
};

// Returns a callback shaped to match react-error-boundary's `onError` prop, so consumers using
// that library can report to Flare without wrapping their app in our own boundary.
export function flareReactErrorHandler(options?: FlareReactErrorHandlerOptions): FlareReactErrorHandlerCallback {
    const flare = resolveFlare(options?.flare);
    tagReactFramework(flare);

    return (error: unknown, errorInfo: { componentStack?: string }) => {
        const errorObject = convertToError(error);

        options?.beforeEvaluate?.({ error: errorObject, errorInfo });

        const rawStack = errorInfo.componentStack ?? '';

        const context = buildReactContext(rawStack);

        const finalContext =
            options?.beforeSubmit?.({
                error: errorObject,
                errorInfo,
                context,
            }) ?? context;

        // See FlareErrorBoundary: parse the decode field from the original error after beforeSubmit so
        // a fresh-literal hook can't drop it; rejection is swallowed so the reporter can't crash the host.
        flare.reportSilently(errorObject, contextToAttributes(finalContext, parseMinifiedReactError(errorObject)));

        options?.afterSubmit?.({ error: errorObject, errorInfo, context: finalContext });
    };
}
