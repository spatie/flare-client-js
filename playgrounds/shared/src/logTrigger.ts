import type { LogAttributeValue, LogLevel, LogScenario } from './logScenarios';

// Structural type so shared has no @flareapp dependency. The attribute param uses
// `LogAttributeValue` (not `unknown`) so the real `flare` satisfies this type.
export type PlaygroundFlare = {
    logger: Record<LogLevel, (message: string, attributes?: Record<string, LogAttributeValue>) => void>;
    flush: (timeoutMs?: number) => Promise<void>;
};

export function fireLogScenario(flare: PlaygroundFlare, scenario: LogScenario): void {
    for (let i = 0; i < scenario.count; i++) {
        flare.logger[scenario.level](scenario.message, scenario.attributes);
    }
    if (scenario.flushOnTrigger) {
        void flare.flush();
    }
}
