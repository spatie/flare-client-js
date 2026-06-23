import { Scope } from '@flareapp/core';

import type { RequestContext } from '../types';

export class NodeScope extends Scope {
    request: RequestContext = {};
}
