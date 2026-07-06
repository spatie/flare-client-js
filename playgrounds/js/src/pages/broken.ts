import { coverageFor, fireLogScenario, logCoverageFor, logScenarioById, testIds } from '@flareapp/playgrounds-shared';
import axios from 'axios';

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

    const logScenarios = logCoverageFor('js');
    const logButtons = logScenarios
        .map(
            (scenario) => `
            <button data-log-scenario="${scenario.id}" data-testid="${testIds.logTrigger(scenario.id)}" class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand">
                <div class="font-medium">${scenario.label}</div>
                <div class="text-xs opacity-60 font-mono">${scenario.id}</div>
            </button>
        `,
        )
        .join('');

    const buttons = scenarios
        .map(
            (scenario) => `
            <button data-scenario="${scenario.id}" data-testid="trigger-${scenario.id}" class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand">
                <div class="font-medium">${scenario.label}</div>
                <div class="text-xs opacity-60 font-mono">${scenario.id}</div>
            </button>
        `,
        )
        .join('');

    renderLayout(
        root,
        `<section>
            <h1 class="text-xl font-semibold mb-2">Error playground</h1>
            <p class="text-sm opacity-70 mb-6">Each button triggers a deterministic error scenario.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${buttons}</div>
            <h2 class="text-lg font-semibold mt-8 mb-2">Logging</h2>
            <p class="text-sm opacity-70 mb-4">Each button records one or more structured logs.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${logButtons}</div>
            <h2 class="text-lg font-semibold mt-8 mb-2">Tracing</h2>
            <p class="text-sm opacity-70 mb-4">Each button fires a same-origin request that produces a request span.</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button data-testid="trace-fetch" class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand">
                    <div class="font-medium">Trigger traced fetch</div>
                    <div class="text-xs opacity-60 font-mono">browser_fetch</div>
                </button>
                <button data-testid="trace-xhr" class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand">
                    <div class="font-medium">Trigger traced XHR</div>
                    <div class="text-xs opacity-60 font-mono">browser_xhr</div>
                </button>
                <button data-testid="trace-axios" class="rounded-lg border border-surface-border bg-surface px-4 py-3 text-left text-sm hover:border-brand">
                    <div class="font-medium">Trigger traced axios (XHR)</div>
                    <div class="text-xs opacity-60 font-mono">browser_xhr via axios</div>
                </button>
            </div>
        </section>`,
    );

    root.querySelectorAll<HTMLButtonElement>('button[data-scenario]').forEach((button) => {
        button.addEventListener('click', () => {
            const id = button.dataset.scenario ?? '';
            const trigger = triggers[id];
            if (!trigger) return;
            void trigger();
        });
    });

    root.querySelectorAll<HTMLButtonElement>('button[data-log-scenario]').forEach((button) => {
        button.addEventListener('click', () => {
            const scenario = logScenarioById(button.dataset.logScenario ?? '');
            if (scenario) fireLogScenario(flare, scenario);
        });
    });

    root.querySelector<HTMLButtonElement>('button[data-testid="trace-fetch"]')?.addEventListener('click', async () => {
        await fetch(window.location.href, { method: 'GET' }); // same-origin -> span + traceparent injected
        flare.flush(); // force the span buffer to POST promptly so the e2e assertion is fast
    });

    root.querySelector<HTMLButtonElement>('button[data-testid="trace-xhr"]')?.addEventListener('click', () => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', window.location.href); // same-origin -> span + traceparent injected
        xhr.addEventListener('loadend', () => flare.flush()); // flush after the span ends
        xhr.send();
    });

    root.querySelector<HTMLButtonElement>('button[data-testid="trace-axios"]')?.addEventListener('click', async () => {
        await axios.get(window.location.href); // axios browser adapter uses XMLHttpRequest
        flare.flush();
    });
};
