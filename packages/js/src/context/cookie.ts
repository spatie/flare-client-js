export default function cookie() {
    if (!window.document.cookie) {
        return {};
    }

    const cookies: { [key: string]: string } = {};

    for (const raw of window.document.cookie.split('; ')) {
        const eq = raw.indexOf('=');
        if (eq === -1) {
            continue;
        }

        const name = raw.slice(0, eq);
        const value = raw.slice(eq + 1);
        cookies[name] = value;
    }

    if (Object.keys(cookies).length === 0) {
        return {};
    }

    return { cookies };
}
