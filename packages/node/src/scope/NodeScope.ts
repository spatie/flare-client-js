import { Scope } from '@flareapp/core';

import type { RequestContext, User } from '../types';

export class NodeScope extends Scope {
    request: RequestContext = {};
    user: User | null = null;
}
