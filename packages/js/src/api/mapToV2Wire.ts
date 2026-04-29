import { CLIENT_VERSION } from '../env';
import { Config, Context, Report, StackFrame } from '../types';
import { glowsToEvents } from '../util/glowsToEvents';

import { V2AttributeValue, V2Attributes, V2StackFrame, V2WirePayload } from './v2WireTypes';

const KNOWN_CONTEXT_BUCKETS = new Set(['request', 'request_data', 'cookies', 'context']);

const NON_APPLICATION_FRAME_PATTERN = /node_modules|vendor|chunk-/;

export function mapToV2Wire(report: Report, config: Config): V2WirePayload {
    const wire: V2WirePayload = {
        seenAtUnixNano: Math.round(report.seen_at * 1_000_000_000),
        stacktrace: report.stacktrace.map(mapStackFrame),
        events: glowsToEvents(report.glows),
        attributes: buildAttributes(report, config),
    };

    if (report.exception_class) {
        wire.exceptionClass = report.exception_class;
    }
    if (report.message != null) {
        wire.message = report.message;
    }
    if (report.sourcemap_version_id) {
        wire.sourcemapVersionId = report.sourcemap_version_id;
    }

    return wire;
}

function mapStackFrame(frame: StackFrame): V2StackFrame {
    const out: V2StackFrame = {
        file: frame.file,
        lineNumber: frame.line_number,
        isApplicationFrame: !NON_APPLICATION_FRAME_PATTERN.test(frame.file),
    };

    if (frame.column_number != null) {
        out.columnNumber = frame.column_number;
    }
    if (frame.method) {
        out.method = frame.method;
    }
    if (frame.class != null) {
        out.class = frame.class;
    }
    if (frame.code_snippet) {
        out.codeSnippet = frame.code_snippet;
    }

    return out;
}

function buildAttributes(report: Report, config: Config): V2Attributes {
    const attrs: V2Attributes = {
        'telemetry.sdk.language': 'javascript',
        'telemetry.sdk.name': '@flareapp/js',
        'telemetry.sdk.version': CLIENT_VERSION,
        'flare.language.name': 'javascript',
        'flare.entry_point.type': 'web',
    };

    if (typeof window !== 'undefined' && window.location && window.location.href) {
        attrs['flare.entry_point.value'] = window.location.href;
    }

    if (config.stage) {
        attrs['service.stage'] = config.stage;
    }
    if (config.version) {
        attrs['service.version'] = config.version;
    }

    const context: Context = report.context ?? {};

    if (context.request?.url) attrs['url.full'] = String(context.request.url);
    if (context.request?.useragent) attrs['user_agent.original'] = String(context.request.useragent);
    if (context.request?.referrer) attrs['http.request.referrer'] = String(context.request.referrer);
    if (context.request?.readyState) attrs['document.ready_state'] = String(context.request.readyState);

    if (context.request_data?.queryString) {
        attrs['url.query'] = context.request_data.queryString as V2AttributeValue;
    }
    if (context.cookies) {
        attrs['http.request.cookies'] = context.cookies as V2AttributeValue;
    }

    const custom = buildCustomContext(context);
    if (Object.keys(custom).length > 0) {
        attrs['context.custom'] = custom;
    }

    return attrs;
}

function buildCustomContext(context: Context): { [k: string]: V2AttributeValue } {
    const custom: { [k: string]: V2AttributeValue } = {};

    // Passed-context: any top-level key not in known buckets.
    for (const key of Object.keys(context)) {
        if (KNOWN_CONTEXT_BUCKETS.has(key)) continue;
        custom[key] = context[key] as V2AttributeValue;
    }

    // addContext bucket: context.context.* — flattened into custom siblings.
    // addContext wins on collision (matches the spread precedence in Flare.report).
    const added = (context as any).context;
    if (added && typeof added === 'object') {
        for (const key of Object.keys(added)) {
            custom[key] = added[key] as V2AttributeValue;
        }
    }

    return custom;
}
