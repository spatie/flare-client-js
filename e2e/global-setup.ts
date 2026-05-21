import { startFakeFlareServer } from './fake-flare-server';

const PORT = Number(process.env.FAKE_FLARE_PORT ?? 7765);

declare global {
    var __fakeFlareServer: Awaited<ReturnType<typeof startFakeFlareServer>> | undefined;
}

export default async function globalSetup(): Promise<void> {
    const server = await startFakeFlareServer({ port: PORT });
    globalThis.__fakeFlareServer = server;
    process.env.FAKE_FLARE_URL = server.url;
    process.env.FAKE_FLARE_PORT = String(server.port);
}
