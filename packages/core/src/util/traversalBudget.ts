/**
 * Cycle detection only tracks the ancestor path, so a value holding the same child under two keys is not
 * a cycle but still costs 2^depth to walk. Host data (glows, addContext, span attributes) reaches that
 * shape through any object graph shared by reference. These caps bound the walk; real payloads are
 * nowhere near them.
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
