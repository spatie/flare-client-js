import { describe, expect, test, vi } from 'vitest';

import { createHandlerSet, createPatchLifecycle, type Unsubscribe } from '../src/instrument/handlers';

function fakePatch() {
    return { install: vi.fn(), uninstall: vi.fn() };
}

describe('createPatchLifecycle', () => {
    test('installs on the first retain only', () => {
        const patch = fakePatch();
        const lifecycle = createPatchLifecycle(patch);

        lifecycle.retain();
        lifecycle.retain();

        expect(patch.install).toHaveBeenCalledTimes(1);
    });

    test('uninstalls only once the last holder releases', () => {
        const patch = fakePatch();
        const lifecycle = createPatchLifecycle(patch);
        const first = lifecycle.retain();
        const second = lifecycle.retain();

        first();
        expect(patch.uninstall).not.toHaveBeenCalled();

        second();
        expect(patch.uninstall).toHaveBeenCalledTimes(1);
    });

    test('a release called twice does not uninstall while a holder remains', () => {
        const patch = fakePatch();
        const lifecycle = createPatchLifecycle(patch);
        const first = lifecycle.retain();
        lifecycle.retain();

        first();
        first();

        expect(patch.uninstall).not.toHaveBeenCalled();
    });

    test('reinstalls when a holder arrives after the count fell to zero', () => {
        const patch = fakePatch();
        const lifecycle = createPatchLifecycle(patch);

        lifecycle.retain()();
        lifecycle.retain();

        expect(patch.install).toHaveBeenCalledTimes(2);
    });
});

describe('createHandlerSet', () => {
    test('calls every handler in registration order', () => {
        const calls: string[] = [];
        const set = createHandlerSet<(v: string) => void>(createPatchLifecycle(fakePatch()));
        set.add(() => calls.push('first'));
        set.add(() => calls.push('second'));

        set.each((handler) => handler('x'));

        expect(calls).toEqual(['first', 'second']);
    });

    test('a throwing handler does not stop the others and does not escape', () => {
        const after = vi.fn();
        const set = createHandlerSet<() => void>(createPatchLifecycle(fakePatch()));
        set.add(() => {
            throw new Error('handler blew up');
        });
        set.add(after);

        expect(() => set.each((handler) => handler())).not.toThrow();
        expect(after).toHaveBeenCalledTimes(1);
    });

    test('a handler that unsubscribes during the loop still lets the rest run', () => {
        const last = vi.fn();
        const set = createHandlerSet<() => void>(createPatchLifecycle(fakePatch()));
        const remove: Unsubscribe = set.add(() => remove());
        set.add(last);

        set.each((handler) => handler());

        expect(last).toHaveBeenCalledTimes(1);
        expect(set.size).toBe(1);
    });

    test('unsubscribing removes the handler and releases the patch', () => {
        const patch = fakePatch();
        const set = createHandlerSet<() => void>(createPatchLifecycle(patch));
        const run = vi.fn();
        const remove = set.add(run);

        remove();
        set.each((handler) => handler());

        expect(run).not.toHaveBeenCalled();
        expect(patch.uninstall).toHaveBeenCalledTimes(1);
    });

    test('clear removes every handler and releases the patch', () => {
        const patch = fakePatch();
        const set = createHandlerSet<() => void>(createPatchLifecycle(patch));
        set.add(() => {});
        set.add(() => {});

        set.clear();

        expect(set.size).toBe(0);
        expect(patch.uninstall).toHaveBeenCalledTimes(1);
    });

    test('a duplicate add is absorbed and only the first unsubscribe removes the handler', () => {
        const patch = fakePatch();
        const run = vi.fn();
        const set = createHandlerSet<() => void>(createPatchLifecycle(patch));
        const first = set.add(run);
        const second = set.add(run);

        // Second add didn't grow size or retain the patch a second time
        expect(set.size).toBe(1);
        expect(patch.install).toHaveBeenCalledTimes(1);

        // Calling the second token doesn't remove the handler
        second();
        set.each((handler) => handler());
        expect(run).toHaveBeenCalledTimes(1);

        // Calling the first token does remove it and releases the patch
        first();
        set.each((handler) => handler());
        expect(run).toHaveBeenCalledTimes(1);
        expect(patch.uninstall).toHaveBeenCalledTimes(1);
    });
});
