import { Attributes } from '../types';

export default function cookie(): Attributes {
    if (!window.document.cookie) {
        return {};
    }

    const cookies: { [key: string]: string } = {};

    window.document.cookie.split('; ').forEach((rawCookie) => {
        const [name, value] = rawCookie.split(/=/);
        cookies[name] = value;
    });

    return {
        'http.request.cookies': cookies,
    };
}
