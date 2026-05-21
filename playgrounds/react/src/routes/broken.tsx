import { coverageFor, testIds } from '@flareapp/playgrounds-shared';
import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { flare } from '../flare';
import { rootRoute } from './__root';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type RenderTrigger = 'render-error' | 'boundary-reset' | null;

const MaybeThrowing = ({ trigger }: { trigger: RenderTrigger }) => {
    if (trigger === 'render-error' || trigger === 'boundary-reset') {
        throw new Error(trigger);
    }
    return null;
};

const eventTriggers: Record<string, () => void | Promise<void>> = {
    'sync-throw': () => {
        throw new Error('sync-throw');
    },
    'async-throw': async () => {
        await sleep(20);
        throw new Error('async-throw');
    },
    'unhandled-rejection': () => {
        void Promise.reject(new Error('unhandled-rejection'));
    },
    'manual-report': () => {
        void flare.report(new Error('manual-report'), {
            'context.scenario': { source: 'manual-report', userId: 'usr_42' },
        });
    },
    'glow-then-throw': () => {
        flare.glow('clicked checkout', 'info', { step: 1 });
        flare.glow('validated cart', 'info', { step: 2 });
        flare.glow('called payment', 'warning', { step: 3 });
        throw new Error('glow-then-throw');
    },
    'hook-drop-report': () => {
        void flare.report(new Error('hook-drop-report'));
    },
    'hook-mutate-report': () => {
        void flare.report(new Error('hook-mutate-report'));
    },
    'sourcemap-mapped': () => {
        throw new Error('sourcemap-mapped');
    },
};

const BrokenPage = () => {
    const scenarios = coverageFor('react');
    const [renderTrigger, setRenderTrigger] = useState<RenderTrigger>(null);

    const onClick = (id: string) => {
        if (id === 'render-error' || id === 'boundary-reset') {
            setRenderTrigger(id);
            return;
        }
        const trigger = eventTriggers[id];
        if (!trigger) return;
        void trigger();
    };

    return (
        <section>
            <h1 className="text-xl font-semibold mb-2">Error playground</h1>
            <p className="text-sm opacity-70 mb-6">Each button triggers a deterministic error scenario.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {scenarios.map((scenario) => (
                    <button
                        key={scenario.id}
                        type="button"
                        data-testid={testIds.brokenTrigger(scenario.id)}
                        onClick={() => onClick(scenario.id)}
                        className="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand"
                    >
                        <div className="font-medium">{scenario.label}</div>
                        <div className="text-xs opacity-60 font-mono">{scenario.id}</div>
                    </button>
                ))}
            </div>
            <MaybeThrowing trigger={renderTrigger} />
        </section>
    );
};

export const brokenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/broken',
    component: BrokenPage,
});
