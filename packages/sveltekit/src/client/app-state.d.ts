declare module '$app/state' {
    const page: {
        url: URL;
        params: Record<string, string>;
        route: { id: string | null };
    };
}
