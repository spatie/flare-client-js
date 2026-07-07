import { AppState, type AppStateStatus } from 'react-native';

/**
 * Flush the log buffer when the app backgrounds. Gate on `background` only: iOS fires `inactive` on every
 * transient interruption (app-switcher peek, Control Center, incoming call), so gating avoids flooding the
 * network. Mirrors the browser scheduler gating on `hidden`, not every blur. Delivery is best-effort (see
 * `ReactNativeFlushScheduler`).
 *
 * Returns an uninstaller that removes the listener via the subscription handle (modern RN API; do NOT use
 * the removed `AppState.removeEventListener`).
 */
export function installAppStateFlush(getFlush: () => (() => void) | undefined): () => void {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'background') {
            getFlush()?.();
        }
    });

    return () => subscription.remove();
}
