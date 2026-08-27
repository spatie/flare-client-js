/** Effective connection quality. The API never reports 5g: a 5g device reports '4g'. */
export type EffectiveConnectionType = 'slow-2g' | '2g' | '3g' | '4g';

/** Normalised device info. Every field optional: each provider fills what it reads, the mapper drops the rest. */
export type DeviceInfo = {
    os?: { name?: string; version?: string };
    runtime?: { name?: string; version?: string };
    device?: {
        type?: string;
        model?: string;
        memoryGb?: number;
        cpuCores?: number;
        screen?: { width?: number; height?: number; scale?: number };
    };
    network?: {
        effectiveType?: EffectiveConnectionType;
        downlinkMbps?: number;
        rttMs?: number;
        online?: boolean;
    };
    app?: { version?: string; id?: string };
    locale?: { language?: string; timezone?: string };
};
