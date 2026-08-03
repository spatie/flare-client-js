import type { Attributes, Config, Framework, SdkInfo } from '../types';

/**
 * The resource map stamped on a logs or traces envelope: `base` (the caller's own resource-level attributes)
 * with SDK, service and framework identity merged over it. Identity wins, so a collector cannot overwrite
 * `telemetry.sdk.name` with a user value.
 */
export function buildResourceIdentity(
    base: Attributes,
    config: Config,
    sdk: SdkInfo,
    framework: Framework | null,
): Attributes {
    const identity: Attributes = {
        'telemetry.sdk.language': 'javascript',
        'telemetry.sdk.name': sdk.name,
        'telemetry.sdk.version': sdk.version,
        'flare.language.name': 'javascript',
    };
    if (config.serviceName) {
        identity['service.name'] = config.serviceName;
    }
    if (config.version) {
        identity['service.version'] = config.version;
    }
    if (config.stage) {
        identity['service.stage'] = config.stage;
    }
    if (framework?.name) {
        identity['flare.framework.name'] = framework.name;
    }
    if (framework?.version) {
        identity['flare.framework.version'] = framework.version;
    }
    return { ...base, ...identity };
}
