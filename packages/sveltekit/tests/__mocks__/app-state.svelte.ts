// Stand-in for `$app/state`, aliased in vitest.config.mts. A `.svelte.ts` module so the fields are
// real runes: a plain object would let the module under test read them, but nothing would ever
// re-run its `$effect`, and the reads-are-the-body contract could not be tested at all.
export const page: {
    url: URL;
    params: Record<string, string>;
    route: { id: string | null };
} = $state({
    url: new URL('http://localhost/'),
    params: {},
    route: { id: null },
});

export const navigating: {
    from: { url: URL; route: { id: string | null } } | null;
    to: { url: URL; route: { id: string | null } } | null;
    type: 'form' | 'leave' | 'link' | 'goto' | 'popstate' | null;
    willUnload: boolean;
    delta: number | null;
    complete: Promise<void> | null;
} = $state({
    from: null,
    to: null,
    type: null,
    willUnload: false,
    delta: null,
    complete: null,
});
