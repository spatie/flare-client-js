import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { flare } from '../src';

beforeAll(() => {
    flare.removeProcessListeners();
});

afterAll(() => {
    flare.removeProcessListeners();
});

describe('concurrent request scope isolation', () => {
    it('glows, attributes, user, entryPoint do not leak across requests', async () => {
        const captured: Array<Record<string, unknown>> = [];

        async function request(label: string) {
            return flare.runWithContext({ path: `/${label}` }, async () => {
                flare.glow(`glow-${label}`);
                flare.addContext(`ctx-${label}`, label);
                flare.setUser({ id: `u-${label}` });
                flare.setEntryPoint({ identifier: `/handler/${label}`, type: 'http' });
                await new Promise((r) => setTimeout(r, Math.random() * 20));
                const scope = flare.getContext()!;
                const custom = (scope.pendingAttributes['context.custom'] ?? {}) as Record<string, unknown>;
                captured.push({
                    label,
                    glows: scope.glows.map((g) => g.name),
                    customKeys: Object.keys(custom),
                    userId: scope.pendingAttributes['user.id'],
                    entryPointId: scope.entryPoint?.identifier,
                });
            });
        }

        await Promise.all(['a', 'b', 'c'].map(request));
        captured.sort((x, y) => String(x.label).localeCompare(String(y.label)));

        for (const row of captured) {
            const label = row.label;
            expect(row.glows).toEqual([`glow-${label}`]);
            expect(row.customKeys).toContain(`ctx-${label}`);
            expect(row.userId).toBe(`u-${label}`);
            expect(row.entryPointId).toBe(`/handler/${label}`);
        }
    });
});
