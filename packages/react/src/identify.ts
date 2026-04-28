import { flare } from '@flareapp/js';
import * as React from 'react';

import { PACKAGE_VERSION } from './constants';

let registered = false;

export function registerReactSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/react', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'React', version: React.version });
}
