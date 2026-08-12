import type { AnyValue, AttributeValue, Attributes, KeyValue } from '../types';
import {
    createTraversalBudget,
    MAX_TRAVERSAL_DEPTH,
    spendNode,
    TRUNCATED,
    type TraversalBudget,
} from '../util/traversalBudget';

/**
 * `inPath` tracks ancestors on the current branch only (added on enter, removed on exit), mirroring
 * flatJsonStringify's decycle. A global "seen" set would mis-flag an object referenced twice in sibling branches.
 *
 * Also bounded by depth and node count; see traversalBudget.ts. Pass `budget` to make several calls
 * share one allowance; without it every call gets its own.
 */
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
    // Charged before the leaf branches: a wide primitive leaf is re-walked once per path too, so leaving
    // it free means the budget cannot bound the work.
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
    // One budget for the whole attribute set: a per-attribute budget multiplies the worst case by
    // maxAttributesPerSpan.
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
