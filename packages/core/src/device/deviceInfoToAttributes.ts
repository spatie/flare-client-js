import type { AttributeValue, Attributes } from '../types';
import { setDefined } from '../util/setDefined';
import type { DeviceInfo } from './types';

/** Map `DeviceInfo` to wire attributes: flat keys plus a `context.device` card. Shared by every SDK, so keys never drift. */
export function deviceInfoToAttributes(info: DeviceInfo): Attributes {
    const attrs: Attributes = {};

    setDefined(attrs, 'os.name', info.os?.name);
    setDefined(attrs, 'os.version', info.os?.version);
    setDefined(attrs, 'process.runtime.name', info.runtime?.name);
    setDefined(attrs, 'process.runtime.version', info.runtime?.version);

    setDefined(attrs, 'device.type', info.device?.type);
    setDefined(attrs, 'device.model.name', info.device?.model);
    setDefined(attrs, 'device.memory_gb', info.device?.memoryGb);
    setDefined(attrs, 'device.cpu_cores', info.device?.cpuCores);
    setDefined(attrs, 'device.screen.width', info.device?.screen?.width);
    setDefined(attrs, 'device.screen.height', info.device?.screen?.height);
    setDefined(attrs, 'device.screen.scale', info.device?.screen?.scale);

    setDefined(attrs, 'network.effective_type', info.network?.effectiveType);
    setDefined(attrs, 'network.downlink_mbps', info.network?.downlinkMbps);
    setDefined(attrs, 'network.rtt_ms', info.network?.rttMs);
    setDefined(attrs, 'network.online', info.network?.online);

    setDefined(attrs, 'app.version', info.app?.version);
    setDefined(attrs, 'app.id', info.app?.id);

    const group = buildDeviceContextGroup(info);
    if (Object.keys(group).length > 0) {
        attrs['context.device'] = group;
    }

    return attrs;
}

/**
 * `context.device` card for the error UI. Rendered one level deep, so values stay scalar. Built only when
 * a device or network signal exists (an os-only Node report gets none).
 */
export function buildDeviceContextGroup(info: DeviceInfo): Record<string, AttributeValue> {
    if (!hasDeviceSignal(info.device) && !hasNetworkSignal(info.network)) {
        return {};
    }

    const group: Record<string, AttributeValue> = {};

    const os = [info.os?.name, info.os?.version].filter((value) => value != null).join(' ');
    if (os) {
        group.OS = os;
    }

    setDefined(group, 'Model', info.device?.model);
    setDefined(group, 'Type', info.device?.type);

    const screen = info.device?.screen;
    if (screen?.width != null && screen?.height != null) {
        group.Screen =
            screen.scale != null
                ? `${screen.width} × ${screen.height} @ ${screen.scale}x`
                : `${screen.width} × ${screen.height}`;
    }
    if (info.device?.memoryGb != null) {
        group.Memory = `${info.device.memoryGb} GB`;
    }
    setDefined(group, 'CPU cores', info.device?.cpuCores);

    setDefined(group, 'Connection', info.network?.effectiveType);
    if (info.network?.downlinkMbps != null) {
        group.Downlink = `${info.network.downlinkMbps} Mbps`;
    }
    if (info.network?.rttMs != null) {
        group.RTT = `${info.network.rttMs} ms`;
    }
    setDefined(group, 'Online', info.network?.online);

    setDefined(group, 'App version', info.app?.version);
    setDefined(group, 'App ID', info.app?.id);
    setDefined(group, 'Language', info.locale?.language);
    setDefined(group, 'Timezone', info.locale?.timezone);

    return group;
}

function hasDeviceSignal(device: DeviceInfo['device']): boolean {
    return (
        device != null &&
        (device.type != null ||
            device.model != null ||
            device.memoryGb != null ||
            device.cpuCores != null ||
            device.screen?.width != null ||
            device.screen?.height != null)
    );
}

function hasNetworkSignal(network: DeviceInfo['network']): boolean {
    return (
        network != null &&
        (network.effectiveType != null ||
            network.downlinkMbps != null ||
            network.rttMs != null ||
            network.online != null)
    );
}
