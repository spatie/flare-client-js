import { CHROMIUM_STACK_REGEX, FIREFOX_SAFARI_STACK_REGEX } from './constants';
import { ComponentStackFrame } from './types';

// React's `errorInfo.componentStack` is a newline-separated, browser-formatted string. We parse it
// into structured frames here so the Flare UI can render proper file/line links instead of a blob.
// Falls back to component-name-only when the format is unrecognised (rather than dropping the line).
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

            // For unrecognized formats, we'll strip the leading "at " if it is present
            const component = line.replace(/^at\s+/, '');

            return {
                component,
                file: null,
                line: null,
                column: null,
            };
        });
}
