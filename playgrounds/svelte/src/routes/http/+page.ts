import type { PageLoad } from './$types';

/**
 * Universal load using the `fetch` SvelteKit provides. Kit routes it through `window.fetch` at call
 * time (fetcher.js:137 -> :151), so Flare's patch sees it and it MUST produce a browser_fetch span
 * on client navigation. On the server there is no patch and no span, which is expected.
 */
export const load: PageLoad = async ({ fetch }) => {
    const res = await fetch('/api/echo?scenario=kit-load-fetch&delay=50');
    return { loaded: (await res.json()) as { ok: boolean; at: string } };
};
