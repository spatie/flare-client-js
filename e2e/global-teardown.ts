export default async function globalTeardown(): Promise<void> {
    const server = globalThis.__fakeFlareServer;
    if (server) {
        await server.stop();
        globalThis.__fakeFlareServer = undefined;
    }
}
