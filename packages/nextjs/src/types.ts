export type FlareNextjsPluginOptions = {
    apiKey: string;
    apiEndpoint?: string;
    runInDevelopment?: boolean;
    version?: string;
    // Delete the generated `.map` files from the build output after they are uploaded to Flare.
    //
    // Defaults to true, and only ever touches the client build: the wrapper force-enables
    // `productionBrowserSourceMaps`, so those `.map` files would otherwise be publicly served and leak the
    // app's original client source. Server and edge maps always stay on disk, since nothing serves them to
    // a browser and removing them costs local stack debugging. `@flareapp/webpack` and `@flareapp/vite`
    // default to false instead, since they never enable emission on your behalf.
    removeSourcemaps?: boolean;
    publicPath?: string;
};
