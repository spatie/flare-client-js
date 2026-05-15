import { convertToError, flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext } from '../types';
import { getRouteContext } from './getRouteContext';

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

export function captureError(rawError: unknown, options?: CaptureErrorOptions): void {
    registerSvelteKitSdkIdentity();
    const error = convertToError(rawError);
    const route = getRouteContext();

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

    Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});
}
