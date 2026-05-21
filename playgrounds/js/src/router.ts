export type RouteMatch = { path: string; params: Record<string, string> };
export type RouteHandler = (match: RouteMatch, root: HTMLElement) => void | Promise<void>;

type Route = { pattern: RegExp; keys: string[]; handler: RouteHandler };

const compile = (pattern: string): { regex: RegExp; keys: string[] } => {
    const keys: string[] = [];
    const regex = new RegExp(
        '^' +
            pattern.replace(/\/:([^/]+)/g, (_match, key: string) => {
                keys.push(key);
                return '/([^/]+)';
            }) +
            '/?$'
    );
    return { regex, keys };
};

export const createRouter = (root: HTMLElement) => {
    const routes: Route[] = [];
    let fallback: RouteHandler | null = null;

    const resolve = async (): Promise<void> => {
        const path = window.location.pathname;
        for (const route of routes) {
            const match = route.pattern.exec(path);
            if (!match) continue;
            const params: Record<string, string> = {};
            route.keys.forEach((key, index) => {
                params[key] = decodeURIComponent(match[index + 1]);
            });
            await route.handler({ path, params }, root);
            return;
        }
        if (fallback) await fallback({ path, params: {} }, root);
    };

    window.addEventListener('popstate', () => {
        void resolve();
    });

    document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest('a[data-link]') as HTMLAnchorElement | null;
        if (!anchor) return;
        event.preventDefault();
        navigate(anchor.getAttribute('href') ?? '/');
    });

    const navigate = (href: string): void => {
        window.history.pushState({}, '', href);
        void resolve();
    };

    return {
        on: (pattern: string, handler: RouteHandler) => {
            const { regex, keys } = compile(pattern);
            routes.push({ pattern: regex, keys, handler });
        },
        fallback: (handler: RouteHandler) => {
            fallback = handler;
        },
        navigate,
        start: () => resolve(),
    };
};
