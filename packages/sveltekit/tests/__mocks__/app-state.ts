export const page: {
    url: URL;
    params: Record<string, string>;
    route: { id: string | null };
} = {
    url: new URL('http://localhost/'),
    params: {},
    route: { id: null },
};
