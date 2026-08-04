import { fireHttpScenario, httpScenarioUrl, sameOriginHttpScenarios, testIds } from '@flareapp/playgrounds-shared';
import { withFlareProfiler } from '@flareapp/react/profiler';
import { useState } from 'react';
import type { RouteObject } from 'react-router';

export async function httpLoader(): Promise<{ loadedAt: string }> {
    // react-router opens its nav root with hold: true and settles once the loader resolves
    // (traceReactRouter in packages/react/src/react-router.ts). This fetch runs inside that hold.
    await fetch(httpScenarioUrl('loader-fetch'));
    return { loadedAt: new Date().toISOString() };
}

const HttpPage = () => {
    const [result, setResult] = useState('idle');

    return (
        <section>
            <h1 className="text-xl font-semibold mb-2">HTTP playground</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sameOriginHttpScenarios.map((scenario) => (
                    <button
                        key={scenario.id}
                        type="button"
                        data-testid={testIds.httpTrigger(scenario.id)}
                        onClick={() => void fireHttpScenario(scenario).then(setResult)}
                        className="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
                    >
                        <div className="font-medium">{scenario.label}</div>
                        <div className="text-xs opacity-60 font-mono">{scenario.id}</div>
                    </button>
                ))}
            </div>
            <p className="mt-6 text-sm font-mono opacity-70" data-testid={testIds.httpResult}>
                {result}
            </p>
        </section>
    );
};

export const httpRoute: RouteObject = {
    path: 'http',
    loader: httpLoader,
    Component: withFlareProfiler(HttpPage, { name: 'HttpPage' }),
};
