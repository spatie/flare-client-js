/**
 * Hostnames the dev and preview servers accept besides localhost.
 *
 * Vite rejects a request whose Host header it does not know, so putting a Herd/Valet proxy in front
 * of a playground fails until its hostname is listed here. The point of proxying is the screenshots:
 * `host.name` and `server.address` come from the browser's location, so without it every span in a
 * launch post reads "localhost".
 *
 * `.test` is reserved for local use (RFC 6761), so allowing the suffix cannot match a real site.
 */
export const playgroundAllowedHosts = ['.test'];
