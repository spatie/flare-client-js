export default {
    '*.{js,ts,tsx,vue}': ['oxlint --fix', 'oxfmt'],
    '*.{json,md,css,html}': 'oxfmt',
};
