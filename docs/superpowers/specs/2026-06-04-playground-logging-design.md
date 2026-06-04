# Playground logging — shared log-scenarios across frameworks

Date: 2026-06-04
Status: Approved (design)

## Problem

The logging feature (`flare.logger.*`, spec `2026-06-03-core-logging-design.md`) is
implemented and shipped. The playgrounds exercise the SDK uniformly across four
frameworks (js, react, vue, svelte) via a shared spec — `errorScenarios` +
`coverageFor` + `testIds` — rendered on each `/broken` page and asserted by a
shared Playwright runner. Logging has no equivalent: only the js playground has a
single ad-hoc "Record a log" button (added for the unload e2e in the core-logging
work). This design adds logging to the playgrounds the same way error scenarios
work: a shared, data-driven log-scenarios model rendered across all four
frameworks, with e2e coverage per framework.

## Goals

- A shared `logScenarios` list mirroring the `errorScenarios` pattern.
- A curated scenario set: info, warning, error, info-with-context, burst.
- Each framework's `/broken` page renders a button per log scenario.
- Each framework's flare init opts logging in (`enableLogs` + `logsIngestUrl`).
- Data-driven e2e: each log scenario asserted across all four frameworks.
- The existing js keepalive-on-unload test is folded into the shared model as a
  non-flushing, js-only scenario (replacing the ad-hoc button).

## Non-goals

- Per-level exhaustive coverage (all 8 levels) — the curated set is enough.
- Unit tests (this is playground UI + e2e only).
- Changing any `@flareapp/*` package behavior.
- A dedicated logging route — triggers live in a section on the existing
  `/broken` page.

## Shared log-scenarios model

New files in `playgrounds/shared/src/`, exported from `index.ts`.

### `logScenarios.ts`

```ts
export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

export type LogScenario = {
    id: string;
    label: string;
    level: LogLevel;
    message: string;
    attributes?: Record<string, unknown>;
    count: number; // 1, or N for a burst
    flushOnTrigger: boolean; // true: record then flush() for deterministic e2e
};

export const logScenarios: LogScenario[] = [
    { id: 'log-info', label: 'Log info', level: 'info', message: 'playground-info', count: 1, flushOnTrigger: true },
    {
        id: 'log-warning',
        label: 'Log warning',
        level: 'warning',
        message: 'playground-warning',
        count: 1,
        flushOnTrigger: true,
    },
    {
        id: 'log-error',
        label: 'Log error',
        level: 'error',
        message: 'playground-error',
        count: 1,
        flushOnTrigger: true,
    },
    {
        id: 'log-context',
        label: 'Log info with context',
        level: 'info',
        message: 'playground-context',
        count: 1,
        flushOnTrigger: true,
        attributes: { 'context.scenario': { source: 'logger', userId: 'usr_42' } },
    },
    {
        id: 'log-burst',
        label: 'Log burst (5)',
        level: 'info',
        message: 'playground-burst',
        count: 5,
        flushOnTrigger: true,
    },
    // js-only: keepalive-on-unload. Buffered, NOT flushed on click; the unload
    // navigation triggers the keepalive flush.
    {
        id: 'log-unload',
        label: 'Log then unload',
        level: 'info',
        message: 'e2e-unload-log',
        count: 1,
        flushOnTrigger: false,
    },
];

export const logScenarioById = (id: string): LogScenario | undefined => logScenarios.find((s) => s.id === id);
```

The `LogLevel` union duplicates `@flareapp/core`'s `MessageLevel` deliberately —
`playgrounds/shared` is a framework-agnostic fixture package and must not depend
on an SDK package. The 8 level names are stable.

### `logCoverage` (in `coverage.ts`, alongside `coverageFor`)

```ts
import { logScenarios, type LogScenario } from './logScenarios';

const excludeLogs: Record<Framework, string[]> = {
    js: [],
    react: ['log-unload'],
    vue: ['log-unload'],
    svelte: ['log-unload'],
};

export const logCoverageFor = (framework: Framework): LogScenario[] =>
    logScenarios.filter((s) => !excludeLogs[framework].includes(s.id));
```

`log-unload` is js-only: keepalive-on-unload is identical browser behavior across
all frameworks (they all run the same `@flareapp/js` browser flare), so testing
it once is sufficient.

### `testIds.ts`

Add: `logTrigger: (scenarioId: string) => \`log-trigger-${scenarioId}\``.

### `logTrigger.ts` — the one place log-firing logic lives

```ts
import type { LogLevel, LogScenario } from './logScenarios';

// Structural type so shared has no @flareapp dependency.
export type PlaygroundFlare = {
    logger: Record<LogLevel, (message: string, attributes?: Record<string, unknown>) => void>;
    flush: (timeoutMs?: number) => Promise<void>;
};

export function fireLogScenario(flare: PlaygroundFlare, scenario: LogScenario): void {
    for (let i = 0; i < scenario.count; i++) {
        flare.logger[scenario.level](scenario.message, scenario.attributes);
    }
    if (scenario.flushOnTrigger) {
        void flare.flush();
    }
}
```

`flushOnTrigger: true` records then flushes so the e2e sees the log within the
HTTP round-trip rather than after the 5s batch timer — no need to lower the
playground's flush interval. The burst records 5 then flushes once, producing a
single envelope with 5 records (exercising in-envelope batching).

## Per-framework wiring

### Flare init (enable logs)

In each framework's flare init, when `VITE_FLARE_URL` is set, add to the
`flare.configure({ ingestUrl: url, ... })` call:
`logsIngestUrl: url.replace('/api/reports', '/api/logs')` and `enableLogs: true`.

- `playgrounds/react/src/flare.ts`
- `playgrounds/vue/src/flare.ts`
- `playgrounds/svelte/src/lib/flare.client.ts`
- `playgrounds/js/src/flare.ts` already has this (from the core-logging work) — no
  change.

(The svelte server init `flare.server.ts` is not touched — logging triggers are
client-side browser logs.)

### UI — a "Logging" section on each `/broken` page

Each framework's broken page renders a button per `logCoverageFor(framework)`
scenario, with `data-testid={testIds.logTrigger(scenario.id)}`, click ->
`fireLogScenario(flare, scenario)`. The section sits below the existing error
scenario buttons.

- `playgrounds/js/src/pages/broken.ts` — REPLACE the existing ad-hoc
  `trigger-log` button with the data-driven log buttons. The unload behavior is
  now the `log-unload` scenario (`flushOnTrigger: false`), whose button keeps the
  same firing semantics (record without flush). Its test id changes from
  `trigger-log` to `log-trigger-log-unload`.
- `playgrounds/react/src/routes/broken.tsx`
- `playgrounds/vue/` broken route (`brokenTrigger.ts` + the route component)
- `playgrounds/svelte/src/routes/broken/+page.svelte`

Each framework imports `logCoverageFor`, `testIds`, `fireLogScenario` from
`@flareapp/playgrounds-shared` and its own `flare`.

## e2e (all frameworks, data-driven)

### `e2e/specs/logShared.ts`

```ts
import { expect, type Page } from '@playwright/test';
import { logCoverageFor, testIds, type Framework, type LogScenario } from '../../playgrounds/shared/src';
import type { FakeFlare, FakeFlareRecord } from '../fixtures/fake-flare';

type LogRecord = { body?: { stringValue?: string }; severityText?: string; attributes?: unknown[] };

const recordsIn = (record: FakeFlareRecord): LogRecord[] => {
    const env = record.bodyJson as { resourceLogs?: Array<{ scopeLogs?: Array<{ logRecords?: LogRecord[] }> }> } | null;
    return env?.resourceLogs?.flatMap((rl) => rl.scopeLogs?.flatMap((sl) => sl.logRecords ?? []) ?? []) ?? [];
};

export const runLogScenario = async (page: Page, fakeFlare: FakeFlare, scenario: LogScenario): Promise<void> => {
    const logPromise = fakeFlare.waitForLog({
        predicate: (rec) => recordsIn(rec).some((r) => r.body?.stringValue === scenario.message),
    });

    await page.getByTestId(testIds.logTrigger(scenario.id)).click();
    const received = await logPromise;

    const matching = recordsIn(received).filter((r) => r.body?.stringValue === scenario.message);
    expect(matching.length).toBe(scenario.count);
    expect(matching[0].severityText).toBe(scenario.level.toUpperCase());
    if (scenario.attributes) {
        expect(Array.isArray(matching[0].attributes)).toBe(true);
        expect((matching[0].attributes ?? []).length).toBeGreaterThan(0);
    }
};

export const logScenariosFor = (framework: Framework): LogScenario[] => logCoverageFor(framework);
```

### Per-framework specs

Each of `e2e/specs/{js,react,vue,svelte}.spec.ts` gets:

```ts
test.describe('<framework> logging', () => {
    for (const scenario of logScenariosFor('<framework>')) {
        test(scenario.id, async ({ page, fakeFlare }) => {
            await page.goto('/broken');
            await page.waitForLoadState('networkidle');
            await runLogScenario(page, fakeFlare, scenario);
        });
    }
});
```

For js, `logScenariosFor('js')` includes `log-unload`, but the unload scenario is
`flushOnTrigger: false` — clicking it does NOT send, so the data-driven
`runLogScenario` (which waits for the log right after click) would time out.
Therefore `log-unload` is EXCLUDED from the js data-driven loop and keeps its
dedicated existing unload test (records, asserts none sent, navigates to
`about:blank`, asserts the keepalive POST arrives). Concretely: the js spec loops
`logScenariosFor('js').filter((s) => s.flushOnTrigger)` for the data-driven block,
and the existing `js logging` unload test is updated to click
`testIds.logTrigger('log-unload')` instead of the old `trigger-log` id.

The fake server already records `POST /api/logs` (endpoint `logs`) and the fixture
exposes `waitForLog` + `logs()` (added in the core-logging e2e work). The fixture
auto-resets per test, so each log test starts clean.

## Testing

- e2e is the test surface. `npx playwright test --project=<fw>` per framework, or
  `npm run test:e2e` for all four. Each framework's logging describe block must
  pass; the js unload test must still pass against the renamed test id.
- No unit tests (playground/fixture code).

## Files

New:

- `playgrounds/shared/src/logScenarios.ts`
- `playgrounds/shared/src/logTrigger.ts`
- `e2e/specs/logShared.ts`

Modified:

- `playgrounds/shared/src/coverage.ts` (add `logCoverageFor`)
- `playgrounds/shared/src/testIds.ts` (add `logTrigger`)
- `playgrounds/shared/src/index.ts` (export the new modules)
- `playgrounds/react/src/flare.ts`, `playgrounds/vue/src/flare.ts`,
  `playgrounds/svelte/src/lib/flare.client.ts` (enable logs)
- `playgrounds/js/src/pages/broken.ts` (replace ad-hoc button with data-driven
  log section)
- `playgrounds/react/src/routes/broken.tsx`, the vue broken route,
  `playgrounds/svelte/src/routes/broken/+page.svelte` (add log section)
- `e2e/specs/js.spec.ts`, `react.spec.ts`, `vue.spec.ts`, `svelte.spec.ts` (add
  logging describe blocks; js: update the unload test's test id)
