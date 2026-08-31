import type { AnyValue, AttributeValue, Attributes, KeyValue } from '../types';
import {
    createTraversalBudget,
    MAX_TRAVERSAL_DEPTH,
    spendNode,
    TRUNCATED,
    type TraversalBudget,
} from '../util/traversalBudget';

// Converts one attribute value to the OpenTelemetry `AnyValue` shape. Strings, numbers, and booleans become
// leaves; arrays and objects are walked recursively. A value OpenTelemetry cannot carry (null, undefined,
// NaN, functions) becomes null and the caller drops that key.
//
// A value that contains itself becomes the string `[Circular]`. `inPath` tracks only the current value's
// parents, so the same object used twice side by side is not wrongly flagged as circular.
//
// Stops at a maximum depth and node count, see traversalBudget.ts. Pass `budget` to share one allowance
// across several calls.
export function valueToOpenTelemetry(
    value: AttributeValue,
    inPath: WeakSet<object> = new WeakSet(),
    budget: TraversalBudget = createTraversalBudget(),
): AnyValue | null {
    return convert(value, inPath, 0, budget);
}

function convert(
    value: AttributeValue,
    inPath: WeakSet<object>,
    depth: number,
    budget: TraversalBudget,
): AnyValue | null {
    // Must run before the string/number checks: strings and numbers have to count against the budget too.
    // Skipping them once let one attribute walk 17 million strings before the counter caught it.
    if (!spendNode(budget)) {
        return { stringValue: TRUNCATED };
    }

    if (typeof value === 'string') {
        return { stringValue: value };
    }
    if (typeof value === 'boolean') {
        return { boolValue: value };
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return null;
        }
        return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
    }
    if (value === null || value === undefined) {
        return null;
    }

    if (depth >= MAX_TRAVERSAL_DEPTH) {
        return { stringValue: TRUNCATED };
    }

    if (Array.isArray(value)) {
        if (inPath.has(value)) {
            return { stringValue: '[Circular]' };
        }
        inPath.add(value);
        const values: AnyValue[] = [];
        for (const item of value) {
            const mapped = convert(item, inPath, depth + 1, budget);
            if (mapped !== null) {
                values.push(mapped);
            }
        }
        inPath.delete(value);
        return { arrayValue: { values } };
    }

    if (typeof value === 'object') {
        if (inPath.has(value)) {
            return { stringValue: '[Circular]' };
        }
        inPath.add(value);
        const values: KeyValue[] = [];
        for (const [key, item] of Object.entries(value)) {
            const mapped = convert(item as AttributeValue, inPath, depth + 1, budget);
            if (mapped !== null) {
                values.push({ key, value: mapped });
            }
        }
        inPath.delete(value);
        return { kvlistValue: { values } };
    }

    return null;
}

export function attributesToOpenTelemetry(attributes: Attributes): KeyValue[] {
    // One counter shared by all attributes, not one per attribute. One per attribute would multiply the worst
    // case by maxAttributesPerSpan.
    const budget = createTraversalBudget();
    const out: KeyValue[] = [];
    for (const [key, value] of Object.entries(attributes)) {
        const mapped = valueToOpenTelemetry(value, new WeakSet(), budget);
        if (mapped !== null) {
            out.push({ key, value: mapped });
        }
    }
    return out;
}
