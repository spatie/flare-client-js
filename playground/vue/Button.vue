<template>
    <button
        class="cursor-pointer rounded-md bg-gray-100 px-4 py-2 text-[13px] text-gray-900 transition hover:bg-gray-200"
        v-bind="$attrs"
    >
        <slot />
    </button>
</template>
