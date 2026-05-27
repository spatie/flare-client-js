export type FlareNextjsPluginOptions = {
    apiKey: string;
    apiEndpoint?: string;
    runInDevelopment?: boolean;
    version?: string;
    /** Defaults to false. */
    removeSourcemaps?: boolean;
    publicPath?: string;
};
