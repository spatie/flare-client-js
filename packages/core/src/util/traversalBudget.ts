/**
 * Cycle detection only tracks the ancestor path, so a value holding the same child under two keys is not
 * a cycle but still costs 2^depth to walk. Host data (glows, addContext, span attributes) reaches that
 * shape through any object graph shared by reference.
 *
 * The node cap only bounds that walk if EVERY visited node is charged, primitive leaves included. It used
 * to charge containers only, so 15 shared objects over an array of 1000 strings walked ~17M uncharged
 * strings before the cap fired: 1.2s and 1GB. Callers must spend before their leaf branches return, not
 * after. We do not memoize instead: a value shared under two keys is not a cycle and must not read as one.
 */
export const MAX_TRAVERSAL_DEPTH = 24;
export const MAX_TRAVERSAL_NODES = 50_000;

export type TraversalBudget = { remaining: number };

export function createTraversalBudget(nodes: number = MAX_TRAVERSAL_NODES): TraversalBudget {
    return { remaining: nodes };
}

/** Consumes one node. False once the budget is spent: stop descending. */
export function spendNode(budget: TraversalBudget): boolean {
    if (budget.remaining <= 0) {
        return false;
    }
    budget.remaining--;
    return true;
}

/** Marks where a walk stopped, so a truncated payload does not read as a complete one. */
export const TRUNCATED = '[truncated: too large]';
