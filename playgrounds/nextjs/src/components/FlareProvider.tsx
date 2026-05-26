'use client';

import { FlareErrorBoundary } from '@flareapp/react';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { Fallback } from '@/components/Fallback';
import { initFlare } from '@/flare';

export function FlareProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
        initFlare();
    }, []);

    const pathname = usePathname();

    return (
        <FlareErrorBoundary fallback={Fallback} resetKeys={[pathname]}>
            {children}
        </FlareErrorBoundary>
    );
}
