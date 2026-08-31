// Hostnames the dev and preview servers accept besides localhost.
//
// Vite rejects a request whose Host header it doesn't know, so a Herd/Valet proxy in front of a
// playground fails unless its hostname is listed here. Proxying matters for screenshots: `host.name`
// and `server.address` come from the browser's location, so without it every span reads "localhost".
//
// `.test` is reserved for local use (RFC 6761), so allowing the suffix can't match a real site.
export const playgroundAllowedHosts = ['.test'];
