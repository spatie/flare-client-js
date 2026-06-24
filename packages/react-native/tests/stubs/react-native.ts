export type AppStateStatus = 'active' | 'background' | 'inactive';

export const Platform: {
    OS: string;
    Version: string | number;
    constants?: { Model?: string; Brand?: string; Manufacturer?: string };
} = {
    OS: 'ios',
    Version: '17.0',
};

export const Dimensions: {
    get: (dim: 'window' | 'screen') => { width: number; height: number; scale: number; fontScale: number };
} = {
    get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
};

let appStateListeners: Array<(state: AppStateStatus) => void> = [];

export const AppState = {
    currentState: 'active' as AppStateStatus,
    addEventListener(_type: 'change', cb: (state: AppStateStatus) => void) {
        appStateListeners.push(cb);
        return {
            remove() {
                appStateListeners = appStateListeners.filter((l) => l !== cb);
            },
        };
    },
    // Test-only helpers (not part of the real RN API):
    __emit(state: AppStateStatus) {
        appStateListeners.forEach((l) => l(state));
    },
    __reset() {
        appStateListeners = [];
    },
};
