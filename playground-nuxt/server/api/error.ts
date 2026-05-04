export default defineEventHandler(() => {
    throw createError({
        statusCode: 500,
        statusMessage: 'Intentional server error for testing Flare',
    });
});
