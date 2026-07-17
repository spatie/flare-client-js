import type { ConfigPlugin } from '@expo/config-plugins';
import { describe, expect, test } from 'vitest';

import plugin from '../src/expo';

describe('expo config plugin', () => {
    test('default export is a config-plugin function', () => {
        expect(typeof plugin).toBe('function');
    });

    test('registers mods for both ios and android', () => {
        const config = { name: 'x', slug: 'x' };
        const out = (plugin as ConfigPlugin)(config) as unknown as {
            mods?: {
                ios?: { dangerous?: unknown; xcodeproj?: unknown };
                android?: { dangerous?: unknown; appBuildGradle?: unknown };
            };
        };

        // flare.json must land whichever platform EAS prebuilds, so a dangerous mod is registered for
        // both.
        expect(typeof out.mods?.ios?.dangerous).toBe('function');
        expect(typeof out.mods?.android?.dangerous).toBe('function');
        // Platform-specific native mods: iOS build phase + Android gradle apply.
        expect(typeof out.mods?.ios?.xcodeproj).toBe('function');
        expect(typeof out.mods?.android?.appBuildGradle).toBe('function');
    });
});
