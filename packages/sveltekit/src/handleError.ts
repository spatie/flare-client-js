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
    if (typeof err === 'object' && err !== null) {
        const obj = err as Record<string, unknown>;
        // Direct status on error object
        if (typeof obj.status === 'number' && obj.status >= 400 && obj.status < 500) {
            return true;
        }
        // Nested SvelteKit wrapper: { type: "error", error: {...}, status: N }
        if (obj.type === 'error' && typeof obj.status === 'number' && obj.status >= 400 && obj.status < 500) {
            return true;
        }
    }
    return false;
}

/**
 * SvelteKit serializes errors across the client-server boundary as
 * `{ type: "error", error: { message: "..." }, status: N }`.
 * Unwrap to get the actual error or its message before passing to convertToError.
 */
function unwrapSvelteKitError(error: unknown): unknown {
    if (typeof error !== 'object' || error === null) return error;
    const obj = error as Record<string, unknown>;
    if (obj.type === 'error' && typeof obj.error === 'object' && obj.error !== null) {
        return obj.error;
    }
    return error;
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
            const error = convertToError(unwrapSvelteKitError(input.error));

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
