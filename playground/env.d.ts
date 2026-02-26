/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_FLARE_JS_KEY: string;
    readonly VITE_FLARE_REACT_KEY: string;
    readonly VITE_FLARE_VUE_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent;
    export default component;
}
