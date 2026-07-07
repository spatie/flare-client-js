// RN uses core's identity model: `Flare.setUser` (inherited) projects known fields to the backend-read
// `user.*` keys (id, email, full_name, client address) and bundles extras into `user.attributes`.
export type { User } from '@flareapp/core';
