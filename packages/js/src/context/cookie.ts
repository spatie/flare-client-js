import { Attributes } from '../types';

export default function cookie(): Attributes {
    if (!window.document.cookie) {
        return {};
    }

    const cookies: { [key: string]: string } = {};

    window.document.cookie.split('; ').forEach((rawCookie) => {
        const idx = rawCookie.indexOf('=');
        if (idx === -1) {
            cookies[rawCookie] = '';
            return;
        }
        const name = rawCookie.slice(0, idx);
        const value = rawCookie.slice(idx + 1);
        cookies[name] = value;
    });

    return {
        'http.request.cookies': cookies,
    };
}
