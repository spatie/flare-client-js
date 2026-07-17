export const page: {
    url: URL;
    params: Record<string, string>;
    route: { id: string | null };
} = {
    url: new URL('http://localhost/'),
    params: {},
    route: { id: null },
};

export const navigating: {
    from: { url: URL; route: { id: string | null } } | null;
    to: { url: URL; route: { id: string | null } } | null;
    type: 'form' | 'leave' | 'link' | 'goto' | 'popstate' | null;
    willUnload: boolean;
    delta: number | null;
    complete: Promise<void> | null;
} = {
    from: null,
    to: null,
    type: null,
    willUnload: false,
    delta: null,
    complete: null,
};
