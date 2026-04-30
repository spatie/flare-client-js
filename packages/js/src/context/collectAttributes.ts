import { Attributes } from '../types';

import cookie from './cookie';
import request from './request';
import requestData from './requestData';

export function collectAttributes(): Attributes {
    if (typeof window === 'undefined') {
        return {};
    }

    return {
        ...request(),
        ...requestData(),
        ...cookie(),
    };
}
