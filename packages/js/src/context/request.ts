import { Attributes } from '../types';

export default function request(): Attributes {
    return {
        'url.full': window.location.href,
        'user_agent.original': window.navigator.userAgent,
        'http.request.referrer': window.document.referrer,
        'document.ready_state': window.document.readyState,
    };
}
