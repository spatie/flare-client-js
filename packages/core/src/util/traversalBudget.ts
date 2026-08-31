// Cycle detection only follows the ancestor path, so a value shared under two keys is not a cycle, but
// still costs 2^depth to walk. The node cap must charge every visited node, primitive leaves included,
// before recursing: charging containers only once let 15 shared objects over 1000 strings walk ~17M
// nodes (1.2s, 1GB) before the cap fired. We do not memoize, since a shared value must not read as a cycle.
export const MAX_TRAVERSAL_DEPTH = 24;
export const MAX_TRAVERSAL_NODES = 50_000;

export type TraversalBudget = { remaining: number };

export function createTraversalBudget(nodes: number = MAX_TRAVERSAL_NODES): TraversalBudget {
    return { remaining: nodes };
}

// Consumes one node. False once the budget is spent: stop descending.
export function spendNode(budget: TraversalBudget): boolean {
    if (budget.remaining <= 0) {
        return false;
    }
    budget.remaining--;
    return true;
}

// Marks where a walk stopped, so a truncated payload does not read as a complete one.
export const TRUNCATED = '[truncated: too large]';
