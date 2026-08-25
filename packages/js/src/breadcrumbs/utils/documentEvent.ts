// Capture phase, so we still see an event the app stops from bubbling.
export function onDocumentEvent(name: string, handle: (event: Event) => void): () => void {
    document.addEventListener(name, handle, true);
    return () => document.removeEventListener(name, handle, true);
}
