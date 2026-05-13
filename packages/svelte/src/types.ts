export type SvelteErrorOrigin = 'render' | 'event' | 'effect' | 'unknown';

export interface FlareSvelteContext {
    svelte: {
        componentName: string | null;
        componentHierarchy: string[];
        errorOrigin: SvelteErrorOrigin;
        componentProps?: Record<string, unknown>;
    };
}
