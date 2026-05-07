export default {
    '*.{js,ts,tsx,vue}': ['oxlint --fix --no-error-on-unmatched-pattern', 'oxfmt'],
    '*.{json,md,css,html}': 'oxfmt',
};
