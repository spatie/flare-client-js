export type ElectronFatalMode = 'off' | 'report' | 'report-and-exit';

/** A frame the IPC receiver evaluates for trust. Mirrors Electron's WebFrameMain shape we use. */
export type SenderFrame = { url: string };

export type ElectronOptions = {
    uncaughtExceptionMode?: ElectronFatalMode;
    unhandledRejectionMode?: ElectronFatalMode;
    shutdownTimeoutMs?: number;
    /** Listen to app 'render-process-gone' / 'child-process-gone' and report them. */
    captureRenderProcessGone?: boolean;
    /** Extra URL scheme names (no colon), e.g. 'app', trusted as report senders. */
    trustedProtocols?: string[];
    /** Full override of the sender-trust check. When set, replaces the default policy. */
    trustSender?: (frame: SenderFrame) => boolean;
    /** Max serialized report size in bytes accepted over IPC. */
    maxReportBytes?: number;
};

export type ResolvedElectronOptions = {
    uncaughtExceptionMode: ElectronFatalMode;
    unhandledRejectionMode: ElectronFatalMode;
    shutdownTimeoutMs: number;
    captureRenderProcessGone: boolean;
    trustedProtocols: string[];
    trustSender: ((frame: SenderFrame) => boolean) | null;
    maxReportBytes: number;
};

export const DEFAULT_ELECTRON_OPTIONS: ResolvedElectronOptions = {
    uncaughtExceptionMode: 'report-and-exit',
    unhandledRejectionMode: 'report-and-exit',
    shutdownTimeoutMs: 2000,
    captureRenderProcessGone: true,
    trustedProtocols: [],
    trustSender: null,
    maxReportBytes: 1_000_000,
};
