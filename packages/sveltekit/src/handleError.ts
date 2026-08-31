import { convertToError, flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes.js';
import { registerSvelteKitSdkIdentity } from './identify.js';
import type { FlareSvelteKitContext, HandleErrorWithFlareOptions, SvelteKitRouteContext } from './types.js';

export interface HandleErrorInput {
    error: unknown;
    event?: unknown;
    status: number;
    message: string;
}

export type HandleErrorFn = (input: HandleErrorInput) => MaybePromise<void | App.Error>;

type MaybePromise<T> = T | Promise<T>;

declare namespace App {
    interface Error {
        message: string;
        [key: string]: unknown;
    }
}

function isClientError(status: unknown): boolean {
    if (typeof status !== 'number') {
        return false;
    }
    return status >= 400 && status < 500;
}

// A 4xx is Kit answering the request (not found, unauthorized), not the app failing. Kit reports
// the status on the input, and on the error itself for one thrown by `error()`.
function shouldSkip(input: HandleErrorInput): boolean {
    if (isClientError(input.status)) {
        return true;
    }
    if (typeof input.error !== 'object' || input.error === null) {
        return false;
    }
    return isClientError((input.error as Record<string, unknown>).status);
}

function unwrapSvelteKitError(error: unknown): unknown {
    if (typeof error !== 'object' || error === null) {
        return error;
    }
    const obj = error as Record<string, unknown>;
    if (obj.type === 'error' && typeof obj.error === 'object' && obj.error !== null) {
        return obj.error;
    }
    return error;
}

export function createHandleErrorWithFlare(
    getRouteContext: (input: HandleErrorInput) => SvelteKitRouteContext,
): (handlerOrOptions?: HandleErrorFn | HandleErrorWithFlareOptions) => HandleErrorFn {
    return (handlerOrOptions) => {
        const isOptions =
            handlerOrOptions !== undefined && typeof handlerOrOptions === 'object' && handlerOrOptions !== null;
        const userHandler: HandleErrorFn | undefined =
            typeof handlerOrOptions === 'function' ? handlerOrOptions : undefined;
        const options: HandleErrorWithFlareOptions | undefined = isOptions ? handlerOrOptions : undefined;

        return (input: HandleErrorInput) => {
            if (shouldSkip(input)) {
                return userHandler?.(input);
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

            return userHandler?.(input);
        };
    };
}
