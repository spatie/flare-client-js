import type { Report } from '@flareapp/core';
import type { IpcMain } from 'electron';

import { FLARE_IPC_CHANNEL } from '../constants';
import type { ResolvedElectronOptions, SenderFrame } from '../types';

type ReceiverDeps = {
    getOptions: () => ResolvedElectronOptions;
    /** Called with a validated, parsed report. ElectronFlare wires this to its send pipeline. */
    onReport: (report: Report) => Promise<void>;
};

/** Module-level ownership token for the single flare:report channel. */
let currentOwner: object | null = null;

/** Default sender-trust check: accept file: and localhost/127.0.0.1 only, plus configured custom protocols. */
export function defaultTrustPolicy(frame: SenderFrame, opts: ResolvedElectronOptions): boolean {
    let parsed: URL;
    try {
        parsed = new URL(frame.url);
    } catch {
        return false;
    }
    const scheme = parsed.protocol.replace(/:$/, '');
    if (scheme === 'file') {
        // A foreign host on file: is untrusted; accept only host-less or localhost file URLs.
        return parsed.hostname === '' || parsed.hostname === 'localhost';
    }
    const isLoopback =
        parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
    if ((scheme === 'http' || scheme === 'https') && isLoopback) {
        return true;
    }
    if (opts.trustedProtocols.includes(scheme)) {
        return true;
    }
    return false;
}

function isTrusted(frame: SenderFrame | undefined, opts: ResolvedElectronOptions): boolean {
    if (!frame || typeof frame.url !== 'string') {
        return false;
    }
    if (opts.trustSender) {
        return opts.trustSender(frame);
    }
    return defaultTrustPolicy(frame, opts);
}

/**
 * Minimal top-level structural guard for a parsed report, not an exhaustive StackFrame/SpanEvent
 * validator: a compromised renderer could forge any valid-looking shape anyway. The security boundary
 * is the sender-trust check plus the byte-size cap; this only rejects obviously-wrong payloads.
 */
function isReportShape(value: unknown): value is Report {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const r = value as Record<string, unknown>;
    return (
        typeof r.seenAtUnixNano === 'number' &&
        Array.isArray(r.stacktrace) &&
        Array.isArray(r.events) &&
        typeof r.attributes === 'object' &&
        r.attributes !== null &&
        !Array.isArray(r.attributes)
    );
}

export function registerIpcReceiver(ipcMain: IpcMain, owner: object, deps: ReceiverDeps): void {
    if (currentOwner === owner) {
        return; // idempotent for same owner
    }
    if (currentOwner !== null) {
        ipcMain.removeHandler(FLARE_IPC_CHANNEL); // take over from a previous owner
    }
    currentOwner = owner;

    ipcMain.handle(FLARE_IPC_CHANNEL, (async (event: { senderFrame?: SenderFrame }, payload: unknown) => {
        const opts = deps.getOptions();
        if (!isTrusted(event.senderFrame, opts)) {
            return;
        }
        if (typeof payload !== 'string') {
            return;
        }
        if (Buffer.byteLength(payload, 'utf8') > opts.maxReportBytes) {
            return;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(payload);
        } catch {
            return;
        }
        if (!isReportShape(parsed)) {
            return;
        }
        await deps.onReport(parsed);
    }) as any);
}

export function disposeIpcReceiver(ipcMain: IpcMain, owner: object): void {
    if (currentOwner !== owner) {
        return; // only the current owner may remove the live handler
    }
    ipcMain.removeHandler(FLARE_IPC_CHANNEL);
    currentOwner = null;
}
