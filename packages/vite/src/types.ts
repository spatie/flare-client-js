export type FlareVitePluginOptions = {
    apiKey: string;
    base?: string;
    apiEndpoint?: string;
    runInDevelopment?: boolean;
    version?: string;
    removeSourcemaps?: boolean;
};

export type Sourcemap = {
    originalFile: string;
    content: string;
    sourcemapPath: string;
};
