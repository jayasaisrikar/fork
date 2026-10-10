// integer cents everywhere, dollars only at the MCP amount field and in the UI
export type Cents = number;

export function formatUsd(cents: Cents): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const text = `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `−${text}` : text;
}

export interface Share {
  id: string;
  weight: number;
}

// floor every share, then hand out the leftover cents by largest remainder (ties go to the lower id)
export function allocateProRata(total: Cents, shares: Share[]): Map<string, Cents> {
  if (!Number.isInteger(total) || total < 0)
    throw new Error('total must be whole, non-negative cents');
  const weightSum = shares.reduce((sum, share) => sum + share.weight, 0);
  if (weightSum <= 0) throw new Error('nothing to allocate across');

  const rows = shares.map(({ id, weight }) => {
    const product = weight * total;
    if (!Number.isSafeInteger(product)) throw new Error('amounts too large to split exactly');
    return { id, cents: Math.floor(product / weightSum), remainder: product % weightSum };
  });

  const leftover = total - rows.reduce((sum, row) => sum + row.cents, 0);
  const byRemainder = [...rows].sort(
    (a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id),
  );
  for (const row of byRemainder.slice(0, leftover)) row.cents += 1;

  return new Map(rows.map((row) => [row.id, row.cents]));
}
