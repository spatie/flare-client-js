export function BuggyComponent() {
    throw new Error('BuggyComponent render error');

    return null;
}
