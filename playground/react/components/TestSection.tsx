import { ReactNode } from 'react';

type Props = {
    title: string;
    description: string;
    children: ReactNode;
};

export function TestSection({ title, description, children }: Props) {
    return (
        <section className="border-t border-gray-200 py-6 first:border-t-0 first:pt-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="mt-1 text-sm text-gray-600">{description}</p>
            <div className="mt-3">{children}</div>
        </section>
    );
}
