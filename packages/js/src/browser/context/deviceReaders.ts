import type { DeviceInfo, EffectiveConnectionType } from '@flareapp/core';

type NetworkInformation = { effectiveType?: string; downlink?: number; rtt?: number };
export type NavigatorWithExtras = Navigator & { deviceMemory?: number; connection?: NetworkInformation };

const EFFECTIVE_TYPES: readonly string[] = ['slow-2g', '2g', '3g', '4g'];

export function readScreen(): NonNullable<NonNullable<DeviceInfo['device']>['screen']> | null {
    if (typeof screen === 'undefined' || typeof screen.width !== 'number' || typeof screen.height !== 'number') {
        return null;
    }
    const scale = typeof devicePixelRatio === 'number' ? devicePixelRatio : undefined;
    return scale != null
        ? { width: screen.width, height: screen.height, scale }
        : { width: screen.width, height: screen.height };
}

export function readNetwork(nav: NavigatorWithExtras): NonNullable<DeviceInfo['network']> | null {
    const network: NonNullable<DeviceInfo['network']> = {};

    if (typeof nav.onLine === 'boolean') {
        network.online = nav.onLine;
    }

    const connection = nav.connection;
    if (connection) {
        const { effectiveType, downlink, rtt } = connection;
        if (effectiveType && EFFECTIVE_TYPES.includes(effectiveType)) {
            network.effectiveType = effectiveType as EffectiveConnectionType;
        }
        if (typeof downlink === 'number') {
            network.downlinkMbps = downlink;
        }
        if (typeof rtt === 'number') {
            network.rttMs = rtt;
        }
    }

    return Object.keys(network).length > 0 ? network : null;
}

export function readTimezone(): string | undefined {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
        return undefined;
    }
}
