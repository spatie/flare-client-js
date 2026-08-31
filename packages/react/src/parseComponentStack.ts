import { CHROMIUM_STACK_REGEX, FIREFOX_SAFARI_STACK_REGEX, REACT_LEGACY_STACK_REGEX } from './constants';
import { ComponentStackFrame } from './types';

// Parses React's newline-separated `errorInfo.componentStack` into structured frames for file/line
// links. React 19 uses browser-native stack formats; 16-18 uses its own synthetic format. Unrecognized
// lines fall back to component-name-only instead of being dropped.
export function parseComponentStack(stack: string): ComponentStackFrame[] {
    return stack
        .split(/\s*\n\s*/g)
        .filter((line) => line.length > 0)
        .map((line): ComponentStackFrame => {
            const chromeMatch = line.match(CHROMIUM_STACK_REGEX);

            if (chromeMatch) {
                return {
                    component: chromeMatch[1],
                    file: chromeMatch[2] ?? null,
                    line: chromeMatch[3] ? Number(chromeMatch[3]) : null,
                    column: chromeMatch[4] ? Number(chromeMatch[4]) : null,
                };
            }

            const firefoxSafariMatch = line.match(FIREFOX_SAFARI_STACK_REGEX);

            if (firefoxSafariMatch) {
                return {
                    component: firefoxSafariMatch[1],
                    file: firefoxSafariMatch[2],
                    line: Number(firefoxSafariMatch[3]),
                    column: Number(firefoxSafariMatch[4]),
                };
            }

            // React 16/17/18 synthetic format: `in ComponentName (at App.jsx:10)`, column/source optional.
            // Distinct enough (`in ` + `(at `) that neither branch above matches it.
            const reactLegacyMatch = line.match(REACT_LEGACY_STACK_REGEX);

            if (reactLegacyMatch) {
                return {
                    component: reactLegacyMatch[1],
                    file: reactLegacyMatch[2] ?? null,
                    line: reactLegacyMatch[3] ? Number(reactLegacyMatch[3]) : null,
                    column: reactLegacyMatch[4] ? Number(reactLegacyMatch[4]) : null,
                };
            }

            // Unrecognized format: strip a leading "at " if present.
            const component = line.replace(/^at\s+/, '');

            return {
                component,
                file: null,
                line: null,
                column: null,
            };
        });
}
