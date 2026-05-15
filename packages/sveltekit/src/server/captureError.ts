import { convertToError, flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext } from '../types';

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

export async function captureError(rawError: unknown, options?: CaptureErrorOptions): Promise<void> {
    registerSvelteKitSdkIdentity();
    const error = convertToError(rawError);

    const context: FlareSvelteKitContext = {
        svelte: {
            componentName: null,
            componentHierarchy: [],
            errorOrigin: 'unknown',
            ...(options?.status !== undefined || options?.message !== undefined
                ? {
                      svelteKit: {
                          routeId: null,
                          url: '',
                          params: {},
                          query: {},
                          ...(options?.status !== undefined ? { status: options.status } : {}),
                          ...(options?.message !== undefined ? { message: options.message } : {}),
                      },
                  }
                : {}),
        },
    };

    flare.reportSilently(error, contextToAttributes(context));
}
