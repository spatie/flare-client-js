import { describe, expect, it } from 'vitest';

import { flare } from '../src';
import { NodeFlare } from '../src/Flare';

describe('Node singleton lifecycle', () => {
    it('configureNode before light: no listeners until light', () => {
        flare.removeProcessListeners();
        const before = process.listeners('uncaughtException').length;
        flare.configureNode({ uncaughtExceptionMode: 'report' });
        expect(process.listeners('uncaughtException').length).toBe(before); // not lit yet
        flare.light('k');
        expect(process.listeners('uncaughtException').length).toBe(before + 1);
        flare.removeProcessListeners();
    });

    it('configureNode after light: dynamically attaches and detaches', () => {
        flare.removeProcessListeners();
        flare.configureNode({ uncaughtExceptionMode: 'off' });
        flare.light('k');
        const baseline = process.listeners('uncaughtException').length;
        flare.configureNode({ uncaughtExceptionMode: 'report' });
        expect(process.listeners('uncaughtException').length).toBe(baseline + 1);
        flare.configureNode({ uncaughtExceptionMode: 'off' });
        expect(process.listeners('uncaughtException').length).toBe(baseline);
        flare.removeProcessListeners();
    });

    it('runWithContext isolates request scope', () => {
        const seen: Array<string | undefined> = [];
        flare.runWithContext({ path: '/a' }, () => {
            seen.push(flare.getContext()?.request.path);
        });
        flare.runWithContext({ path: '/b' }, () => {
            seen.push(flare.getContext()?.request.path);
        });
        expect(flare.getContext()).toBeNull();
        expect(seen).toEqual(['/a', '/b']);
    });

    it('removeProcessListeners then light reattaches handlers', () => {
        const instance = new NodeFlare();
        instance.removeProcessListeners();
        instance.configureNode({ uncaughtExceptionMode: 'report' });
        instance.light('k');
        const after_first_light = process.listeners('uncaughtException').length;
        expect(after_first_light).toBeGreaterThanOrEqual(1);
        const baseline = after_first_light - 1;
        instance.removeProcessListeners();
        expect(process.listeners('uncaughtException').length).toBe(baseline);
        instance.light('k');
        expect(process.listeners('uncaughtException').length).toBe(baseline + 1);
        instance.removeProcessListeners();
    });

    it('supports subclass fluent chaining', () => {
        const instance = new NodeFlare();
        // Type-only check: ensure subclass methods remain chainable
        instance.configure({ stage: 'prod' }).configureNode({ uncaughtExceptionMode: 'off' });
        instance.removeProcessListeners();
    });
});
