export function flattenOnce(array: Array<Array<any>>) {
    return array.reduce((flat, toFlatten) => {
        return flat.concat(toFlatten);
    }, []);
}
