import { flare } from '@flareapp/js';

import { contextToAttributes } from '../contextToAttributes';
import { convertToError } from '../convertToError';
import { registerSvelteKitSdkIdentity } from '../identify';
import type { FlareSvelteKitContext } from '../types';

registerSvelteKitSdkIdentity();

export interface CaptureErrorOptions {
    event?: unknown;
    status?: number;
    message?: string;
}

export async function captureError(rawError: unknown, options?: CaptureErrorOptions): Promise<void> {
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

    Promise.resolve(flare.report(error, contextToAttributes(context))).catch(() => {});
}
