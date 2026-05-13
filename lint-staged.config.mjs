export default {
    '*.{js,ts,tsx,vue,svelte}': ['oxlint --fix --no-error-on-unmatched-pattern', 'oxfmt --no-error-on-unmatched-pattern'],
    '*.{json,md,css,html}': 'oxfmt --no-error-on-unmatched-pattern',
};
