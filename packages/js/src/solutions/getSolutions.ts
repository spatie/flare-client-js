import { Solution, SolutionProvider, SolutionProviderExtraParameters } from '../types';
import { flattenOnce } from '../util';

export function getSolutions(
    solutionProviders: Array<SolutionProvider>,
    error: Error,
    extraSolutionParameters: SolutionProviderExtraParameters = {}
): Promise<Array<Solution>> {
    return new Promise((resolve) => {
        const canSolves = solutionProviders.reduce(
            (canSolves, provider) => {
                canSolves.push(Promise.resolve(provider.canSolve(error, extraSolutionParameters)));

                return canSolves;
            },
            [] as Array<Promise<boolean>>
        );

        Promise.all(canSolves).then((resolvedCanSolves) => {
            const solutionPromises: Array<Promise<Array<Solution>>> = [];

            resolvedCanSolves.forEach((canSolve, i) => {
                if (canSolve) {
                    solutionPromises.push(
                        Promise.resolve(solutionProviders[i].getSolutions(error, extraSolutionParameters))
                    );
                }
            });

            Promise.all(solutionPromises).then((solutions) => {
                resolve(flattenOnce(solutions));
            });
        });
    });
}
