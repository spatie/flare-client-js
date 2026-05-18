import { convertToError, flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes';
import { registerSvelteKitSdkIdentity } from './identify';
import type { FlareSvelteKitContext, SvelteKitRouteContext } from './types';

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

export function createCaptureError(
    getRouteContext: (options?: CaptureErrorOptions) => SvelteKitRouteContext
): (rawError: unknown, options?: CaptureErrorOptions) => void {
    return (rawError, options) => {
        registerSvelteKitSdkIdentity();
        const error = convertToError(rawError);
        const route = getRouteContext(options);

        const context: FlareSvelteKitContext = {
            svelte: {
                componentName: null,
                componentHierarchy: [],
                errorOrigin: 'unknown',
                svelteKit: {
                    ...route,
                    ...(options?.status !== undefined ? { status: options.status } : {}),
                    ...(options?.message !== undefined ? { message: options.message } : {}),
                },
            },
        };

        flare.reportSilently(error, contextToAttributes(context));
    };
}
