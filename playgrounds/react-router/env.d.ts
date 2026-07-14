/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_FLARE_KEY?: string;
    readonly VITE_FLARE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
