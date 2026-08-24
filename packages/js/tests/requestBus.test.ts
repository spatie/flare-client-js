import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    claimRequestMutation,
    hasRequestConsumers,
    publishRequestStart,
    resetRequestBus,
    subscribeToRequests,
    type RequestStart,
} from '../src/instrumentation/requestBus';

const START: RequestStart = { kind: 'fetch', method: 'GET', url: '/api/x', input: '/api/x', init: undefined };

beforeEach(() => resetRequestBus());

describe('subscribers', () => {
    it('reports no consumers until something subscribes', () => {
        expect(hasRequestConsumers()).toBe(false);
        const off = subscribeToRequests(() => {});
        expect(hasRequestConsumers()).toBe(true);
        off();
        expect(hasRequestConsumers()).toBe(false);
    });

    it('hands every subscriber the start and then the settle', () => {
        const settleA = vi.fn();
        const settleB = vi.fn();
        subscribeToRequests(() => ({ onSettle: settleA }));
        subscribeToRequests(() => ({ onSettle: settleB }));

        publishRequestStart(START)?.settle({ status: 204 });

        expect(settleA).toHaveBeenCalledWith({ status: 204 });
        expect(settleB).toHaveBeenCalledWith({ status: 204 });
    });

    it('publishes nothing once a subscriber has torn down', () => {
        const observer = vi.fn();
        const off = subscribeToRequests(observer);
        off();

        expect(publishRequestStart(START)).toBeNull();
        expect(observer).not.toHaveBeenCalled();
    });
});

describe('the request passes through untouched when nothing acts on it', () => {
    it('returns null with no consumers at all', () => {
        expect(publishRequestStart(START)).toBeNull();
    });

    it('returns null when every consumer declines the request', () => {
        subscribeToRequests(() => undefined);
        claimRequestMutation(() => undefined);

        expect(publishRequestStart(START)).toBeNull();
    });
});

describe('the mutation slot', () => {
    it('is the only thing that can replace the init', () => {
        const replacement: RequestInit = { headers: { traceparent: '00-abc' } };
        subscribeToRequests(() => ({ onSettle: vi.fn() }));
        claimRequestMutation(() => ({ init: replacement }));

        expect(publishRequestStart(START)?.init).toBe(replacement);
    });

    it('leaves the init alone when the slot is unclaimed', () => {
        const init: RequestInit = { method: 'POST' };
        subscribeToRequests(() => ({ onSettle: vi.fn() }));

        expect(publishRequestStart({ ...START, init })?.init).toBe(init);
    });

    it('warns loudly and hands the slot to the second claimant', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const first = vi.fn(() => ({ init: { method: 'FIRST' } }));
        const second = vi.fn(() => ({ init: { method: 'SECOND' } }));

        claimRequestMutation(first);
        expect(warn).not.toHaveBeenCalled();
        claimRequestMutation(second);
        expect(warn).toHaveBeenCalledOnce();

        expect(publishRequestStart(START)?.init).toEqual({ method: 'SECOND' });
        expect(first).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('a replaced owner cannot empty the slot under the new owner', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const removeFirst = claimRequestMutation(() => ({ init: { method: 'FIRST' } }));
        claimRequestMutation(() => ({ init: { method: 'SECOND' } }));

        removeFirst();

        expect(publishRequestStart(START)?.init).toEqual({ method: 'SECOND' });
        warn.mockRestore();
    });
});

describe('a consumer that throws never reaches the host', () => {
    it('keeps publishing to the others when one observer throws on start', () => {
        const settle = vi.fn();
        subscribeToRequests(() => {
            throw new Error('boom');
        });
        subscribeToRequests(() => ({ onSettle: settle }));

        publishRequestStart(START)?.settle({ status: 200 });

        expect(settle).toHaveBeenCalledOnce();
    });

    it('keeps publishing to the others when one settle handler throws', () => {
        const settle = vi.fn();
        subscribeToRequests(() => ({
            onSettle() {
                throw new Error('boom');
            },
        }));
        subscribeToRequests(() => ({ onSettle: settle }));

        expect(() => publishRequestStart(START)?.settle({ status: 200 })).not.toThrow();
        expect(settle).toHaveBeenCalledOnce();
    });

    it('still publishes to observers when the mutation slot throws', () => {
        const settle = vi.fn();
        subscribeToRequests(() => ({ onSettle: settle }));
        claimRequestMutation(() => {
            throw new Error('traceparent exploded');
        });

        const published = publishRequestStart(START);
        published?.settle({ status: 500 });

        expect(published?.init).toBe(START.init);
        expect(settle).toHaveBeenCalledWith({ status: 500 });
    });
});
