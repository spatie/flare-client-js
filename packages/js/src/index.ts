import { Flare } from './Flare';
import { catchWindowErrors } from './browser';

// Expose package singleton
export const flare = new Flare();

if (typeof window !== 'undefined' && window) {
    // @ts-expect-error
    window.flare = flare;

    catchWindowErrors();
}

export { Flare } from './Flare';
