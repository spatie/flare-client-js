export default function cookie() {
    if (!window.document.cookie) {
        return {};
    }

    return {
        cookies: window.document.cookie.split('; ').reduce(
            (cookies, cookie) => {
                const [cookieName, cookieValue] = cookie.split(/=/);
                cookies[cookieName] = cookieValue;

                return cookies;
            },
            {} as { [key: string]: string }
        ),
    };
}
