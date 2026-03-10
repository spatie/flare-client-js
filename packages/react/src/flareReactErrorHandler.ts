import { flare } from '@flareapp/js';

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

        flare.report(errorObject, finalContext, { react: { errorInfo } });

        options?.afterSubmit?.({ error: errorObject, errorInfo, context: finalContext });
    };
}
