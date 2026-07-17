declare module '$app/state' {
    const page: {
        url: URL;
        params: Record<string, string>;
        route: { id: string | null };
    };
    const navigating: {
        from: { url: URL; route: { id: string | null } } | null;
        to: { url: URL; route: { id: string | null } } | null;
        type: 'form' | 'leave' | 'link' | 'goto' | 'popstate' | null;
        willUnload: boolean;
        delta: number | null;
        complete: Promise<void> | null;
    };
}
