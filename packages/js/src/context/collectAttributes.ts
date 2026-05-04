import { Attributes } from '../types';

import cookie from './cookie';
import request from './request';
import requestData from './requestData';

export function collectAttributes(urlDenylist: RegExp): Attributes {
    if (typeof window === 'undefined') {
        return {};
    }

    return {
        ...request(urlDenylist),
        ...requestData(urlDenylist),
        ...cookie(),
    };
}
