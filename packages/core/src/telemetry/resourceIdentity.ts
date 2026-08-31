import type { Attributes, Config, Framework, SdkInfo } from '../types';

// Builds the attributes that go on every logs or traces envelope: the caller's own attributes in `base`, with
// our SDK, service and framework identity on top. Our keys win, so a user value cannot overwrite something
// like `telemetry.sdk.name`.
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
