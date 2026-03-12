import { describe, expect, test } from 'vitest';

import { getErrorOrigin } from '../src/getErrorOrigin';

describe('getErrorOrigin', () => {
    describe('development info strings', () => {
        test('maps "setup function" to setup', () => {
            expect(getErrorOrigin('setup function')).toBe('setup');
        });

        test('maps "render function" to render', () => {
            expect(getErrorOrigin('render function')).toBe('render');
        });

        test('maps "component update" to render', () => {
            expect(getErrorOrigin('component update')).toBe('render');
        });

        test('maps "scheduler flush" to render', () => {
            expect(getErrorOrigin('scheduler flush')).toBe('render');
        });

        test('maps watcher-related strings to watcher', () => {
            expect(getErrorOrigin('watcher getter')).toBe('watcher');
            expect(getErrorOrigin('watcher callback')).toBe('watcher');
            expect(getErrorOrigin('watcher cleanup function')).toBe('watcher');
        });

        test('maps event handler strings to event', () => {
            expect(getErrorOrigin('native event handler')).toBe('event');
            expect(getErrorOrigin('component event handler')).toBe('event');
        });

        test('maps lifecycle hook strings to lifecycle', () => {
            expect(getErrorOrigin('beforeCreate hook')).toBe('lifecycle');
            expect(getErrorOrigin('created hook')).toBe('lifecycle');
            expect(getErrorOrigin('beforeMount hook')).toBe('lifecycle');
            expect(getErrorOrigin('mounted hook')).toBe('lifecycle');
            expect(getErrorOrigin('beforeUpdate hook')).toBe('lifecycle');
            expect(getErrorOrigin('updated hook')).toBe('lifecycle');
            expect(getErrorOrigin('beforeUnmount hook')).toBe('lifecycle');
            expect(getErrorOrigin('unmounted hook')).toBe('lifecycle');
            expect(getErrorOrigin('activated hook')).toBe('lifecycle');
            expect(getErrorOrigin('deactivated hook')).toBe('lifecycle');
            expect(getErrorOrigin('errorCaptured hook')).toBe('lifecycle');
            expect(getErrorOrigin('renderTracked hook')).toBe('lifecycle');
            expect(getErrorOrigin('renderTriggered hook')).toBe('lifecycle');
            expect(getErrorOrigin('serverPrefetch hook')).toBe('lifecycle');
        });

        test('maps hook-like strings to lifecycle', () => {
            expect(getErrorOrigin('vnode hook')).toBe('lifecycle');
            expect(getErrorOrigin('directive hook')).toBe('lifecycle');
            expect(getErrorOrigin('transition hook')).toBe('lifecycle');
        });

        test('maps "ref function" to setup', () => {
            expect(getErrorOrigin('ref function')).toBe('setup');
        });

        test('maps "async component loader" to setup', () => {
            expect(getErrorOrigin('async component loader')).toBe('setup');
        });

        test('maps app-level strings to lifecycle', () => {
            expect(getErrorOrigin('app errorHandler')).toBe('lifecycle');
            expect(getErrorOrigin('app warnHandler')).toBe('lifecycle');
            expect(getErrorOrigin('app unmount cleanup function')).toBe('lifecycle');
        });
    });

    describe('production codes', () => {
        test('maps numeric codes to correct origins', () => {
            expect(getErrorOrigin('0')).toBe('setup');
            expect(getErrorOrigin('1')).toBe('render');
            expect(getErrorOrigin('2')).toBe('watcher');
            expect(getErrorOrigin('3')).toBe('watcher');
            expect(getErrorOrigin('4')).toBe('watcher');
            expect(getErrorOrigin('5')).toBe('event');
            expect(getErrorOrigin('6')).toBe('event');
            expect(getErrorOrigin('7')).toBe('lifecycle');
            expect(getErrorOrigin('8')).toBe('lifecycle');
            expect(getErrorOrigin('9')).toBe('lifecycle');
            expect(getErrorOrigin('10')).toBe('lifecycle');
            expect(getErrorOrigin('11')).toBe('lifecycle');
            expect(getErrorOrigin('12')).toBe('setup');
            expect(getErrorOrigin('13')).toBe('setup');
            expect(getErrorOrigin('14')).toBe('render');
            expect(getErrorOrigin('15')).toBe('render');
            expect(getErrorOrigin('16')).toBe('lifecycle');
        });

        test('maps short lifecycle codes to lifecycle', () => {
            expect(getErrorOrigin('sp')).toBe('lifecycle');
            expect(getErrorOrigin('bc')).toBe('lifecycle');
            expect(getErrorOrigin('c')).toBe('lifecycle');
            expect(getErrorOrigin('bm')).toBe('lifecycle');
            expect(getErrorOrigin('m')).toBe('lifecycle');
            expect(getErrorOrigin('bu')).toBe('lifecycle');
            expect(getErrorOrigin('u')).toBe('lifecycle');
            expect(getErrorOrigin('bum')).toBe('lifecycle');
            expect(getErrorOrigin('um')).toBe('lifecycle');
            expect(getErrorOrigin('a')).toBe('lifecycle');
            expect(getErrorOrigin('da')).toBe('lifecycle');
            expect(getErrorOrigin('ec')).toBe('lifecycle');
            expect(getErrorOrigin('rtc')).toBe('lifecycle');
            expect(getErrorOrigin('rtg')).toBe('lifecycle');
        });
    });

    test('returns unknown for unrecognized info strings', () => {
        expect(getErrorOrigin('something unexpected')).toBe('unknown');
        expect(getErrorOrigin('')).toBe('unknown');
    });
});
