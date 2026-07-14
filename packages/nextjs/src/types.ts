export type FlareNextjsPluginOptions = {
    apiKey: string;
    apiEndpoint?: string;
    runInDevelopment?: boolean;
    version?: string;
    /**
     * Delete the generated `.map` files from the build output after they are uploaded to Flare.
     *
     * Defaults to true. The wrapper force-enables `productionBrowserSourceMaps`, so the browser
     * `.map` files would otherwise be publicly served and leak the app's original client source.
     * Set this to false only if you intentionally want the maps to remain in the served output.
     */
    removeSourcemaps?: boolean;
    publicPath?: string;
};
