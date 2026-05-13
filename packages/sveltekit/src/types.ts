import type { FlareSvelteContext } from '@flareapp/svelte';

export interface SvelteKitRouteContext {
    routeId: string | null;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>;
}

export interface FlareSvelteKitContext extends FlareSvelteContext {
    svelte: FlareSvelteContext['svelte'] & {
        svelteKit?: SvelteKitRouteContext & {
            status?: number;
            message?: string;
        };
    };
}

export interface HandleErrorWithFlareOptions {
    beforeEvaluate?: (params: { error: Error; status: number; message: string }) => void;
    beforeSubmit?: (params: {
        error: Error;
        status: number;
        message: string;
        context: FlareSvelteKitContext;
    }) => FlareSvelteKitContext;
    afterSubmit?: (params: { error: Error; status: number; message: string; context: FlareSvelteKitContext }) => void;
}
