export function formatComponentStack(stack: string): string[] {
    return stack.split(/\s*\n\s*/g).filter((line) => line.length > 0);
}
