'use client';

import { testIds } from '@flareapp/playgrounds-shared';
import type { FlareErrorBoundaryFallbackProps } from '@flareapp/react';

export const Fallback = ({ error, resetErrorBoundary }: FlareErrorBoundaryFallbackProps) => (
    <div data-testid={testIds.boundaryFallback} className="p-8 text-center">
        <h2 className="text-lg font-semibold mb-2">Something broke.</h2>
        <p className="text-sm opacity-70 mb-4">{error.message}</p>
        <button
            data-testid={testIds.boundaryReset}
            onClick={resetErrorBoundary}
            className="rounded-lg bg-brand-ink text-white px-4 py-2 text-sm"
        >
            Reset
        </button>
    </div>
);
