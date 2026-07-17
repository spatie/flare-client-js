import type { PageLoad } from './$types';

/**
 * Universal load using the `fetch` SvelteKit provides. Kit sends it through `window.fetch` when it
 * is called, so our patch sees it and it produces a browser_fetch span on a client navigation. On
 * the server there is no patch and no span, which is expected.
 */
export const load: PageLoad = async ({ fetch }) => {
    const res = await fetch('/api/echo?scenario=kit-load-fetch&delay=50');
    return { loaded: (await res.json()) as { ok: boolean; at: string } };
};
