// The RN SDK uses core's identity model: `Flare.setUser` (inherited) projects the
// known fields to the backend-read `user.*` keys (id, email, full_name, client
// address) and bundles any extra key into `user.attributes`.
export type { User } from '@flareapp/core';
