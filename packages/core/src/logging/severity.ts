import type { MessageLevel } from '../types';

const SEVERITY_NUMBERS: Record<MessageLevel, number> = {
    debug: 5,
    info: 9,
    notice: 10,
    warning: 13,
    error: 17,
    critical: 18,
    alert: 19,
    emergency: 21,
};

export function severityNumber(level: MessageLevel): number {
    return SEVERITY_NUMBERS[level];
}

export function severityText(level: MessageLevel): string {
    return level.toUpperCase();
}

export function isAtOrAboveMinimum(level: MessageLevel, minimum: MessageLevel): boolean {
    return severityNumber(level) >= severityNumber(minimum);
}
