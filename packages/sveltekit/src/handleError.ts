import { convertToError, flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes';
import { registerSvelteKitSdkIdentity } from './identify';
import type { FlareSvelteKitContext, HandleErrorWithFlareOptions, SvelteKitRouteContext } from './types';

export interface HandleErrorInput {
    error: unknown;
    event?: unknown;
    status: number;
    message: string;
}

export type HandleErrorFn = (input: HandleErrorInput) => void;

function shouldSkip(input: HandleErrorInput): boolean {
    if (input.status >= 400 && input.status < 500) {
        return true;
    }
    // SvelteKit serializes expected errors (e.g. error(404)) across the network boundary,
    // losing the HttpError class. The client handleError receives them as plain objects
    // with a status property, while input.status is incorrectly set to 500.
    const err = input.error;
    if (typeof err === 'object' && err !== null && 'status' in err) {
        const status = (err as { status: unknown }).status;
        if (typeof status === 'number' && status >= 400 && status < 500) {
            return true;
        }
    }
    return false;
}

/**
 * Factory for SvelteKit's `handleError` hook wrapper. Route context extraction is injected
 * so the same logic works for both client ($app/state) and server (RequestEvent).
 *
 * 4xx errors are skipped (expected in SvelteKit). The returned function accepts either a
 * user handler function (called after reporting) or an options object with lifecycle hooks.
 */
export function createHandleErrorWithFlare(
    getRouteContext: (input: HandleErrorInput) => SvelteKitRouteContext
): (handlerOrOptions?: HandleErrorFn | HandleErrorWithFlareOptions) => HandleErrorFn {
    return (handlerOrOptions) => {
        const isOptions =
            handlerOrOptions !== undefined && typeof handlerOrOptions === 'object' && handlerOrOptions !== null;
        const userHandler: HandleErrorFn | undefined =
            typeof handlerOrOptions === 'function' ? handlerOrOptions : undefined;
        const options: HandleErrorWithFlareOptions | undefined = isOptions ? handlerOrOptions : undefined;

        return (input: HandleErrorInput) => {
            if (shouldSkip(input)) {
                userHandler?.(input);
                return;
            }

            registerSvelteKitSdkIdentity();
            console.log(
                '[DEBUG] input.error type:',
                typeof input.error,
                'instanceof Error:',
                input.error instanceof Error,
                'keys:',
                input.error && typeof input.error === 'object' ? Object.keys(input.error) : 'n/a'
            );
            const error = convertToError(input.error);

            options?.beforeEvaluate?.({ error, status: input.status, message: input.message });

            const route = getRouteContext(input);

            let context: FlareSvelteKitContext = {
                svelte: {
                    componentName: null,
                    componentHierarchy: [],
                    errorOrigin: 'unknown',
                    svelteKit: {
                        ...route,
                        status: input.status,
                        message: input.message,
                    },
                },
            };

            if (options?.beforeSubmit) {
                context = options.beforeSubmit({ error, status: input.status, message: input.message, context });
            }

            flare.reportSilently(error, contextToAttributes(context));

            options?.afterSubmit?.({ error, status: input.status, message: input.message, context });

            userHandler?.(input);
        };
    };
}
