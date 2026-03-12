export function ConditionallyBuggyComponent({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error('ConditionallyBuggyComponent render error');
    }

    return <p className="text-sm text-green-700">ConditionallyBuggyComponent rendered successfully!</p>;
}
