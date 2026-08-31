import { AppState, type AppStateStatus } from 'react-native';

// Flush on `background` only, not `inactive` — iOS fires `inactive` on every transient interruption
// (app-switcher peek, Control Center, calls), which would flood the network.
//
// Removes the listener via the subscription handle; `AppState.removeEventListener` is removed from RN.
export function installAppStateFlush(getFlush: () => (() => void) | undefined): () => void {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'background') {
            getFlush()?.();
        }
    });

    return () => subscription.remove();
}
