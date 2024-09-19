// https://stackoverflow.com/a/11616993/6374824
export function flatJsonStringify(json: Object): string {
    let cache: any = [];

    const flattenedStringifiedJson = JSON.stringify(json, function (_, value) {
        if (typeof value === 'object' && value !== null) {
            if (cache.indexOf(value) !== -1) {
                try {
                    return JSON.parse(JSON.stringify(value));
                } catch (error) {
                    return;
                }
            }
            cache.push(value);
        }
        return value;
    });

    cache = null;

    return flattenedStringifiedJson;
}
