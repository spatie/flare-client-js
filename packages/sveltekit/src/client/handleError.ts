import { flare } from '@flareapp/js';
import { convertToError } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext, HandleErrorWithFlareOptions } from '../types';
import { getRouteContext } from './getRouteContext';

interface HandleErrorInput {
    error: unknown;
    event?: unknown;
    status: number;
    message: string;
}

type HandleErrorFn = (input: HandleErrorInput) => void | Promise<void>;

function is4xxError(input: HandleErrorInput): boolean {
    return input.status >= 400 && input.status < 500;
}

export function handleErrorWithFlare(handlerOrOptions?: HandleErrorFn | HandleErrorWithFlareOptions): HandleErrorFn {
    const isOptions =
        handlerOrOptions !== undefined && typeof handlerOrOptions === 'object' && handlerOrOptions !== null;
    const userHandler: HandleErrorFn | undefined =
        typeof handlerOrOptions === 'function' ? handlerOrOptions : undefined;
    const options: HandleErrorWithFlareOptions | undefined = isOptions ? handlerOrOptions : undefined;

    return (input: HandleErrorInput) => {
        if (is4xxError(input)) {
            userHandler?.(input);
            return;
        }

        registerSvelteKitSdkIdentity();
        const error = convertToError(input.error);

        options?.beforeEvaluate?.({ error, status: input.status, message: input.message });

        const route = getRouteContext();

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

        Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});

        options?.afterSubmit?.({ error, status: input.status, message: input.message, context });

        userHandler?.(input);
    };
}
