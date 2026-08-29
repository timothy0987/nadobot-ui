import { getSubaccountInfo } from './query';

export interface PerpPosition {
  productId: number;
  /** Signed base amount, x18. Positive = long, negative = short. */
  amount: bigint;
  /** Average entry price, x18, derived from the position's virtual quote balance. */
  avgEntryPriceX18: bigint;
}

export async function getPerpPosition(sender: `0x${string}`, productId: number): Promise<PerpPosition | null> {
  const info = await getSubaccountInfo(sender);
  const balance = info.data.perp_balances.find((b: any) => b.product_id === productId);
  if (!balance) return null;

  const amount = BigInt(balance.balance.amount);
  if (amount === 0n) return null;

  const vQuote = BigInt(balance.balance.v_quote_balance);
  const avgEntryPriceX18 = (-vQuote * 10n ** 18n) / amount;

  return { productId, amount, avgEntryPriceX18 };
}
