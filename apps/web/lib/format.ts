import { formatUsd } from '@fork/shared';

export const usd = formatUsd;

// whole dollars where the cents are zero, which is most of this scenario
export function usdShort(cents: number): string {
  const text = formatUsd(cents);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

export const shortHash = (hash: string) =>
  hash.length > 12 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

export function day(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
