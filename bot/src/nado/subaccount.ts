/**
 * Nado subaccounts are identified by a bytes32: 20-byte wallet address + 12-byte name.
 * The name is NOT zero-padded bytes - it's the ASCII text of the name (e.g. "default"),
 * right-padded with zero bytes to 12 bytes total.
 * See: https://docs.nado.xyz/developer-resources/get-started/core-concepts
 */
export function subaccountToBytes32(address: `0x${string}`, name = 'default'): `0x${string}` {
  if (name.length > 12) {
    throw new Error(`Subaccount name "${name}" exceeds 12 bytes`);
  }

  const nameHex = Buffer.from(name, 'ascii').toString('hex').padEnd(24, '0');
  return (address.toLowerCase() + nameHex) as `0x${string}`;
}
