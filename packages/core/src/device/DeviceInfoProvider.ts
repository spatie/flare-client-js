import type { DeviceInfo } from './types';

/** The seam each platform implements to read device info. A `ContextCollector` maps it with `deviceInfoToAttributes`. */
export interface DeviceInfoProvider {
    collect(): DeviceInfo;
}

/** Default for platforms with no device info. */
export class NullDeviceInfoProvider implements DeviceInfoProvider {
    collect(): DeviceInfo {
        return {};
    }
}
