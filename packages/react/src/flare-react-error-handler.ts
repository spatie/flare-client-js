import { flare } from '@flareapp/js';

import { convertToError } from './convert-to-error';
import { formatComponentStack } from './format-component-stack';
import { parseComponentStack } from './parse-component-stack';
import { FlareReactContext } from './types';

export type FlareReactErrorHandlerCallback = (error: unknown, errorInfo: { componentStack?: string }) => void;

export function flareReactErrorHandler(callback?: FlareReactErrorHandlerCallback): FlareReactErrorHandlerCallback {
    return (error: unknown, errorInfo: { componentStack?: string }) => {
        const errorObject = convertToError(error);

        const rawStack = errorInfo.componentStack ?? '';

        const context: FlareReactContext = {
            react: {
                componentStack: formatComponentStack(rawStack),
                componentStackFrames: parseComponentStack(rawStack),
            },
        };

        flare.report(errorObject, context);

        callback?.(error, errorInfo);
    };
}
