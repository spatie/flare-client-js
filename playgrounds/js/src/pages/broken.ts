import { coverageFor } from '@flareapp/playgrounds-shared';

import { flare } from '../flare';
import { renderLayout } from '../layout';
import type { RouteHandler } from '../router';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const triggers: Record<string, () => void | Promise<void>> = {
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

export const renderBroken: RouteHandler = (_match, root) => {
    const scenarios = coverageFor('js');

    const buttons = scenarios
        .map(
            (scenario) => `
            <button data-scenario="${scenario.id}" data-testid="trigger-${scenario.id}" class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand">
                <div class="font-medium">${scenario.label}</div>
                <div class="text-xs opacity-60 font-mono">${scenario.id}</div>
            </button>
        `
        )
        .join('');

    renderLayout(
        root,
        `<section>
            <h1 class="text-xl font-semibold mb-2">Error playground</h1>
            <p class="text-sm opacity-70 mb-6">Each button triggers a deterministic error scenario.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${buttons}</div>
        </section>`
    );

    root.querySelectorAll<HTMLButtonElement>('button[data-scenario]').forEach((button) => {
        button.addEventListener('click', () => {
            const id = button.dataset.scenario ?? '';
            const trigger = triggers[id];
            if (!trigger) return;
            void trigger();
        });
    });
};
