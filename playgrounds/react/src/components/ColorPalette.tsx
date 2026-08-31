import { extractPalette } from '@flareapp/playgrounds-shared';
import { withFlareProfiler } from '@flareapp/react/profiler';
import { useMemo } from 'react';

// Extracts the print's dominant colours on the main thread while rendering — deliberately slow, as
// this playground's example of a component visible in a trace. See extractPalette for the time budget.
export const ColorPalette = withFlareProfiler(
    ({ unsplashId }: { unsplashId: string }) => {
        // Keyed on the photograph, so only the mount pays for it. That is the render the profiler
        // span covers.
        const swatches = useMemo(() => extractPalette(unsplashId), [unsplashId]);

        return (
            <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">Colours in this print</h2>
                <div className="flex gap-2">
                    {swatches.map((swatch) => (
                        <div key={swatch.hex} className="flex-1">
                            <div
                                className="h-10 rounded-lg border border-surface-border"
                                style={{ backgroundColor: swatch.hex }}
                            />
                            <p className="mt-1 font-mono text-[10px] opacity-60">{swatch.hex}</p>
                            <p className="text-[10px] opacity-50">{Math.round(swatch.share * 100)}%</p>
                        </div>
                    ))}
                </div>
            </section>
        );
    },
    { name: 'ColorPalette' },
);
