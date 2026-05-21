import { convertToError, flare } from '@flareapp/js';

import { contextToAttributes } from './contextToAttributes.js';
import { registerSvelteKitSdkIdentity } from './identify.js';
import type { FlareSvelteKitContext, SvelteKitRouteContext } from './types.js';

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

/**
 * Factory for the direct-call error capture API. Unlike handleErrorWithFlare (which wraps
 * SvelteKit's handleError hook), this is called manually by the user in their own hook logic.
 */
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
