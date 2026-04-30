// Internal types — NOT re-exported from packages/js/src/index.ts.
// These describe the v2 wire shape posted to https://ingress.flareapp.io/v1/errors.

export type V2AttributeValue =
    | string
    | number
    | boolean
    | null
    | V2AttributeValue[]
    | { [key: string]: V2AttributeValue };

export type V2Attributes = Record<string, V2AttributeValue>;

export type V2StackFrame = {
    file: string;
    lineNumber: number;
    columnNumber?: number;
    method?: string;
    class?: string;
    codeSnippet?: { [line: number]: string };
    isApplicationFrame?: boolean;
};

export type V2SpanEvent = {
    type: string;
    startTimeUnixNano: number;
    endTimeUnixNano: number | null;
    attributes: V2Attributes;
};

export type V2WirePayload = {
    exceptionClass?: string;
    message?: string;
    seenAtUnixNano: number;
    sourcemapVersionId?: string;
    stacktrace: V2StackFrame[];
    events: V2SpanEvent[];
    attributes: V2Attributes;
};
