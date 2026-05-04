import { flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes';
import { convertToError } from './convertToError';
import { formatComponentStack } from './formatComponentStack';
import { parseComponentStack } from './parseComponentStack';
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

        const context: FlareReactContext = {
            react: {
                componentStack: formatComponentStack(rawStack),
                componentStackFrames: parseComponentStack(rawStack),
            },
        };

        const finalContext =
            options?.beforeSubmit?.({
                error: errorObject,
                errorInfo,
                context,
            }) ?? context;

        // See FlareErrorBoundary: rejection is swallowed so the reporter can't crash the host.
        Promise.resolve(flare.report(errorObject, contextToAttributes(finalContext))).catch(() => {});

        options?.afterSubmit?.({ error: errorObject, errorInfo, context: finalContext });
    };
}
