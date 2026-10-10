import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical';

export function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
