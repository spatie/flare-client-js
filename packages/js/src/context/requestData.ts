import { Attributes } from '../types';

export default function requestData(): Attributes {
    if (!window.location.search) {
        return {};
    }

    return {
        'url.query': window.location.search.replace(/^\?/, ''),
    };
}
