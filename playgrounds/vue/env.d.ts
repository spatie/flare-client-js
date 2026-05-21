/// <reference types="vite/client" />

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, object>;
    export default component;
}

interface ImportMetaEnv {
    readonly VITE_FLARE_KEY?: string;
    readonly VITE_FLARE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
