import { flare } from '@flareapp/js';
import * as React from 'react';

import { PACKAGE_VERSION } from './constants';

// Idempotence guard. Multiple bundles or deduped imports may load this module more than once;
// without the flag we'd overwrite the SDK identity that another integration already set.
let registered = false;

export function registerReactSdkIdentity(): void {
    if (registered) return;
    registered = true;

    flare.setSdkInfo({ name: '@flareapp/react', version: PACKAGE_VERSION });
    flare.setFramework({ name: 'React', version: React.version });
}
