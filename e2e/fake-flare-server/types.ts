export type FakeFlareEndpoint = 'reports' | 'sourcemaps' | 'logs';

export type FakeFlareRecord = {
    endpoint: FakeFlareEndpoint;
    method: string;
    path: string;
    headers: Record<string, string>;
    bodyText: string;
    bodyJson: unknown | null;
    receivedAt: number;
};

export type WaitForOptions = {
    timeout?: number;
    predicate?: (record: FakeFlareRecord) => boolean;
};

export type FakeFlareServer = {
    url: string;
    port: number;
    records(): FakeFlareRecord[];
    reports(): FakeFlareRecord[];
    sourcemaps(): FakeFlareRecord[];
    logs(): FakeFlareRecord[];
    reset(): void;
    waitForReport(options?: WaitForOptions): Promise<FakeFlareRecord>;
    stop(): Promise<void>;
};
