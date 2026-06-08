import { convertToError, flare } from '@flareapp/js';

import { buildReactContext } from './buildReactContext';
import { contextToAttributes } from './contextToAttributes';
import { FlareReactContext } from './types';

export type FlareReactErrorHandlerCallback = (error: unknown, errorInfo: { componentStack?: string }) => void;

export type FlareReactErrorHandlerOptions = {
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
    return (error: unknown, errorInfo: { componentStack?: string }) => {
        const errorObject = convertToError(error);

        options?.beforeEvaluate?.({ error: errorObject, errorInfo });

        const rawStack = errorInfo.componentStack ?? '';

        const context = buildReactContext(rawStack, errorObject);

        const finalContext =
            options?.beforeSubmit?.({
                error: errorObject,
                errorInfo,
                context,
            }) ?? context;

        // See FlareErrorBoundary: rejection is swallowed so the reporter can't crash the host.
        flare.reportSilently(errorObject, contextToAttributes(finalContext));

        options?.afterSubmit?.({ error: errorObject, errorInfo, context: finalContext });
    };
}
