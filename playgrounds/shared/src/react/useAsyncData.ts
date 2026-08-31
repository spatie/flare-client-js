import { useEffect, useState } from 'react';

// Loads page data from the mock catalog API. Deliberately a plain effect rather than a router loader,
// so both React playgrounds fire their requests the same way and the React Router e2e suite keeps its
// loader / loader-less navigation cases intact.
export const useAsyncData = <T>(load: () => Promise<T>, key: string): T | null => {
    const [data, setData] = useState<T | null>(null);

    useEffect(() => {
        let cancelled = false;

        void load().then((value) => {
            if (!cancelled) setData(value);
        });

        return () => {
            cancelled = true;
        };
        // Keyed on the caller's identity string: `load` is a fresh closure on every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return data;
};
