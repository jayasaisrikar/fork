import { describe, expect, it } from 'vitest';
import { withEdgeIdentity } from './edge';

describe('withEdgeIdentity', () => {
  it('replaces whatever identity the browser claimed with the one the platform saw', () => {
    const out = withEdgeIdentity(
      new Headers({
        'x-fork-edge-key': 'guessed',
        'x-fork-client': '10.0.0.1',
        'x-real-ip': '203.0.113.9',
        'x-forwarded-for': '203.0.113.9, 70.1.1.1',
      }),
      'edge-secret',
    );
    expect(out.get('x-fork-edge-key')).toBe('edge-secret');
    expect(out.get('x-fork-client')).toBe('203.0.113.9');
  });

  it('falls back to the first forwarded address', () => {
    const out = withEdgeIdentity(new Headers({ 'x-forwarded-for': '198.51.100.7, 70.1.1.1' }), 'k');
    expect(out.get('x-fork-client')).toBe('198.51.100.7');
  });

  it('sends no identity at all when no edge key is configured', () => {
    const out = withEdgeIdentity(
      new Headers({
        'x-fork-edge-key': 'guessed',
        'x-fork-client': '10.0.0.1',
        'x-real-ip': '1.2.3.4',
      }),
      undefined,
    );
    expect(out.get('x-fork-edge-key')).toBeNull();
    expect(out.get('x-fork-client')).toBeNull();
  });

  it('keeps the other headers', () => {
    const out = withEdgeIdentity(new Headers({ 'content-type': 'application/json' }), 'k');
    expect(out.get('content-type')).toBe('application/json');
  });
});
