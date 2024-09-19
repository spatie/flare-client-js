import cookie from './cookie';
import request from './request';
import requestData from './requestData';
import { Context } from '../types';

export function collectContext(additionalContext: object): Context {
    if (typeof window === 'undefined') {
        return additionalContext;
    }

    return {
        ...cookie(),
        ...request(),
        ...requestData(),
        ...additionalContext,
    };
}
