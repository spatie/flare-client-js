import { Attributes } from '../types';
import { redactFullPath } from '../util';

export default function requestData(urlDenylist: RegExp): Attributes {
    if (typeof window === 'undefined' || !window.location.search) {
        return {};
    }

    return {
        'url.query': redactFullPath(window.location.search, urlDenylist).replace(/^\?/, ''),
    };
}
