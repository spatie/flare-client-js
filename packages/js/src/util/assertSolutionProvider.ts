import { assert } from './assert';

export function assertSolutionProvider(
    solutionProvider: object,
    debug: boolean,
): boolean {
    return (
        assert(
            'canSolve' in solutionProvider,
            'A solution provider without a [canSolve] property was added.',
            debug,
        ) &&
        assert(
            'getSolutions' in solutionProvider,
            'A solution provider without a [getSolutions] property was added.',
            debug,
        )
    );
}
