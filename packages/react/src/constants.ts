// Chrome:
// "at ComponentName (http://localhost:5173/src/App.tsx:12:9)"
// (no source): "at div"
export const CHROMIUM_STACK_REGEX = /^at\s+(\S+)(?:\s+\((.+):(\d+):(\d+)\))?$/;

// Firefox/Safari:
// "ComponentName@http://localhost:5173/src/App.tsx:12:9"
// (no source): "div"
export const FIREFOX_SAFARI_STACK_REGEX = /^(\S+?)@(.+):(\d+):(\d+)$/;
