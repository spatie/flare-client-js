import type { ReactNode } from 'react';

import { FlareProvider } from '@/components/FlareProvider';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata = {
    title: 'Flare Pix (Next.js)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                <FlareProvider>
                    <div className="min-h-screen flex flex-col">
                        <Header />
                        <main className="flex-1 mx-auto max-w-5xl w-full px-6 py-8">{children}</main>
                    </div>
                </FlareProvider>
            </body>
        </html>
    );
}
