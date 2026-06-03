import { describe, expect, it } from 'vitest';

import { isAtOrAboveMinimum, severityNumber, severityText } from '../src/logging/severity';

describe('severity', () => {
    it('maps each level to the PHP severity number', () => {
        expect(severityNumber('debug')).toBe(5);
        expect(severityNumber('info')).toBe(9);
        expect(severityNumber('notice')).toBe(10);
        expect(severityNumber('warning')).toBe(13);
        expect(severityNumber('error')).toBe(17);
        expect(severityNumber('critical')).toBe(18);
        expect(severityNumber('alert')).toBe(19);
        expect(severityNumber('emergency')).toBe(21);
    });

    it('uppercases the level for severityText', () => {
        expect(severityText('info')).toBe('INFO');
        expect(severityText('error')).toBe('ERROR');
    });

    it('compares min-level with strict >= on severity number', () => {
        expect(isAtOrAboveMinimum('warning', 'warning')).toBe(true);
        expect(isAtOrAboveMinimum('error', 'warning')).toBe(true);
        expect(isAtOrAboveMinimum('info', 'warning')).toBe(false);
    });
});
