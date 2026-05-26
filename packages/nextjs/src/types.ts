export type FlareNextjsPluginOptions = {
    apiKey: string;
    apiEndpoint?: string;
    runInDevelopment?: boolean;
    version?: string;
    /** Defaults to true (unlike @flareapp/webpack and @flareapp/vite which default to false). */
    removeSourcemaps?: boolean;
    publicPath?: string;
};
