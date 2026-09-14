export type RoundMode = 'down' | 'up' | 'nearest';

/** Nado rejects any price/size that isn't an exact multiple of the product's increment. */
export function roundToIncrement(value: bigint, increment: bigint, mode: RoundMode): bigint {
  if (increment <= 0n) return value;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const remainder = abs % increment;
  let rounded = abs - remainder;
  if (remainder !== 0n) {
    // 'up'/'down' refer to the signed value, so flip the direction for negatives.
    const awayFromZero = mode === 'nearest' ? remainder * 2n >= increment : (mode === 'up') !== negative;
    if (awayFromZero) rounded += increment;
  }
  return negative ? -rounded : rounded;
}
