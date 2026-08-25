// @vitest-environment jsdom
import type { Attributes, Config } from '@flareapp/core';
import { DEFAULT_URL_DENYLIST } from '@flareapp/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClickRecorder } from '../src/breadcrumbs/ClickRecorder';
import { onDocumentEvent } from '../src/breadcrumbs/documentEvent';
import { elementAttributes, elementSelector, interactiveTarget } from '../src/breadcrumbs/elementSelector';
import { FormChangeRecorder } from '../src/breadcrumbs/FormChangeRecorder';
import { NavigationRecorder } from '../src/breadcrumbs/NavigationRecorder';
import type { BreadcrumbHost } from '../src/breadcrumbs/types';
import { resetNavigation } from '../src/instrumentation/navigation';

type Recorded = { type: string; attributes: Attributes };

function fakeHost(): BreadcrumbHost & { recorded: Recorded[] } {
    const recorded: Recorded[] = [];
    return {
        recorded,
        config: () => ({ urlDenylist: DEFAULT_URL_DENYLIST }) as Config,
        record: (type, attributes) => recorded.push({ type, attributes }),
    };
}

let teardown: (() => void) | null = null;

beforeEach(() => resetNavigation());
afterEach(() => {
    teardown?.();
    teardown = null;
    document.body.innerHTML = '';
});

describe('interactiveTarget', () => {
    it('climbs to the button when the click lands on the label inside it', () => {
        document.body.innerHTML = '<button id="checkout"><span id="label">Buy</span></button>';
        const span = document.getElementById('label')!;

        expect(interactiveTarget(span).id).toBe('checkout');
    });

    it('stops climbing after five levels', () => {
        document.body.innerHTML = '<button id="far"><i><i><i><i><i><i id="deep"></i></i></i></i></i></button>';

        expect(interactiveTarget(document.getElementById('deep')!).id).toBe('deep');
    });

    it('keeps the target when no ancestor is interactive, because React attaches at the root', () => {
        document.body.innerHTML = '<div><div id="plain"></div></div>';

        expect(interactiveTarget(document.getElementById('plain')!).id).toBe('plain');
    });
});

describe('elementSelector', () => {
    it('names an element by tag, id and every class', () => {
        document.body.innerHTML = '<button id="checkout" class="btn btn-primary"></button>';

        expect(elementSelector(document.getElementById('checkout')!)).toBe('button#checkout.btn.btn-primary');
    });

    it('falls back to the tag alone', () => {
        document.body.innerHTML = '<button></button>';

        expect(elementSelector(document.querySelector('button')!)).toBe('button');
    });
});

describe('elementAttributes', () => {
    it('carries the selector and the test id', () => {
        document.body.innerHTML = '<button id="checkout" data-testid="checkout-button"></button>';

        expect(elementAttributes(document.getElementById('checkout')!)).toEqual({
            'browser.element.selector': 'button#checkout',
            'browser.element.test_id': 'checkout-button',
        });
    });

    it('leaves the test id out rather than sending an empty one', () => {
        document.body.innerHTML = '<button id="checkout"></button>';

        expect(elementAttributes(document.getElementById('checkout')!)).toEqual({
            'browser.element.selector': 'button#checkout',
        });
    });
});

describe('onDocumentEvent', () => {
    it('sees an event an app stops from bubbling, and stops on teardown', () => {
        document.body.innerHTML = '<button id="b"></button>';
        const button = document.getElementById('b')!;
        button.addEventListener('click', (event) => event.stopPropagation());
        const seen: string[] = [];

        const stop = onDocumentEvent('click', () => seen.push('click'));
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        stop();
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(seen).toEqual(['click']);
    });
});

describe('ClickRecorder', () => {
    it('records the interactive ancestor and its test id, never the text', () => {
        document.body.innerHTML =
            '<button id="checkout" data-testid="checkout-button"><span>Pay Jane Doe</span></button>';
        const host = fakeHost();
        teardown = new ClickRecorder(host).install();

        document.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(host.recorded).toEqual([
            {
                type: 'browser_click',
                attributes: {
                    'browser.element.selector': 'button#checkout',
                    'browser.element.test_id': 'checkout-button',
                },
            },
        ]);
        expect(JSON.stringify(host.recorded)).not.toContain('Jane Doe');
    });

    it('still sees a click an app stops from bubbling', () => {
        document.body.innerHTML = '<button id="b"></button>';
        const button = document.getElementById('b')!;
        button.addEventListener('click', (event) => event.stopPropagation());
        const host = fakeHost();
        teardown = new ClickRecorder(host).install();

        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(host.recorded).toHaveLength(1);
    });

    it('records nothing after teardown', () => {
        document.body.innerHTML = '<button id="b"></button>';
        const host = fakeHost();
        new ClickRecorder(host).install()();

        document.getElementById('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(host.recorded).toEqual([]);
    });
});

describe('FormChangeRecorder', () => {
    it('records the field on change and never its value', () => {
        document.body.innerHTML = '<input id="email" class="field" />';
        const input = document.getElementById('email') as HTMLInputElement;
        input.value = 'jane@example.com';
        const host = fakeHost();
        teardown = new FormChangeRecorder(host).install();

        input.dispatchEvent(new Event('change', { bubbles: true }));

        expect(host.recorded).toEqual([
            { type: 'browser_input', attributes: { 'browser.element.selector': 'input#email.field' } },
        ]);
        expect(JSON.stringify(host.recorded)).not.toContain('jane@example.com');
    });

    it('ignores input events, so typing cannot flood the buffer', () => {
        document.body.innerHTML = '<input id="email" />';
        const host = fakeHost();
        teardown = new FormChangeRecorder(host).install();

        for (let i = 0; i < 20; i++) {
            document.getElementById('email')!.dispatchEvent(new Event('input', { bubbles: true }));
        }

        expect(host.recorded).toEqual([]);
    });
});

describe('NavigationRecorder', () => {
    it('opens the timeline with where the person landed, and no from', () => {
        window.history.replaceState({}, '', '/products');
        const host = fakeHost();
        teardown = new NavigationRecorder(host).install();

        expect(host.recorded).toHaveLength(1);
        expect(host.recorded[0].type).toBe('browser_route_change');
        expect(host.recorded[0].attributes['browser.route.to']).toContain('/products');
        expect(host.recorded[0].attributes['browser.route.from']).toBeUndefined();
    });

    it('records from and to on a History navigation', () => {
        window.history.replaceState({}, '', '/products');
        const host = fakeHost();
        teardown = new NavigationRecorder(host).install();

        window.history.pushState({}, '', '/cart');

        expect(host.recorded).toHaveLength(2);
        expect(host.recorded[1].attributes['browser.route.from']).toContain('/products');
        expect(host.recorded[1].attributes['browser.route.to']).toContain('/cart');
    });

    it('redacts a denylisted query value in both urls', () => {
        window.history.replaceState({}, '', '/reset?token=abc123');
        const host = fakeHost();
        teardown = new NavigationRecorder(host).install();

        window.history.pushState({}, '', '/done');

        expect(host.recorded[1].attributes['browser.route.from']).toContain('token=[redacted]');
        expect(host.recorded[1].attributes['browser.route.from']).not.toContain('abc123');
    });
});
