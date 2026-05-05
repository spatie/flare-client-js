import { ComponentProps } from 'react';

type Props = ComponentProps<'button'>;

export function Button({ ...props }: Props) {
    return (
        <button
            className="cursor-pointer rounded-md bg-gray-100 px-4 py-2 text-[13px] text-gray-900 transition hover:bg-gray-200"
            {...props}
        />
    );
}
