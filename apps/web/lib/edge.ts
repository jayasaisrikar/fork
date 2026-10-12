// headers the engine uses to tell one visitor from another on the public proof endpoint.
export const EDGE_KEY_HEADER = 'x-fork-edge-key';
export const CLIENT_HEADER = 'x-fork-client';

// rebuilds the request headers for the engine. whatever the browser sent under these two names
// is dropped: the address comes from the hosting platform, which sets x-real-ip and
// x-forwarded-for itself, and the key proves to the engine that this app is the one saying so.
export function withEdgeIdentity(incoming: Headers, key: string | undefined): Headers {
  const headers = new Headers(incoming);
  headers.delete(EDGE_KEY_HEADER);
  headers.delete(CLIENT_HEADER);
  if (!key) return headers;

  const address =
    incoming.get('x-real-ip')?.trim() || incoming.get('x-forwarded-for')?.split(',')[0]?.trim();
  headers.set(EDGE_KEY_HEADER, key);
  if (address) headers.set(CLIENT_HEADER, address);
  return headers;
}
