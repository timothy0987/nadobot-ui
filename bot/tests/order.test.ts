import { signOrder, NadoOrder } from '../src/trading/order';
import { encodeAppendix } from '../src/nado/appendix';
import { subaccountToBytes32 } from '../src/nado/subaccount';
import { privateKeyToAccount } from 'viem/accounts';
import * as clientModule from '../src/viem/client';

describe('Order Signing', () => {
  it('should construct a valid EIP-712 signature for a Nado order', async () => {
    const mockPrivateKey = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const mockAccount = privateKeyToAccount(mockPrivateKey);

    Object.defineProperty(clientModule, 'account', {
      value: mockAccount,
    });

    const mockOrder: NadoOrder = {
      sender: subaccountToBytes32(mockAccount.address),
      priceX18: 1000000000000000000n, // 1.0
      amount: 1n,
      expiration: 1234567890n,
      nonce: 1n,
      appendix: encodeAppendix(),
    };

    const signature = await signOrder(mockOrder, 1);

    expect(signature).toBeDefined();
    expect(signature.startsWith('0x')).toBe(true);
    // V, R, S length in hex is typically 132 chars (65 bytes * 2 + 2 for '0x')
    expect(signature.length).toBeGreaterThan(130);
  });
});

describe('Subaccount encoding', () => {
  it('encodes the "default" subaccount name as ASCII, not zero bytes', () => {
    const address = '0x841fe4876763357975d60da128d8a54bb045d76';
    const result = subaccountToBytes32(address, 'default');
    expect(result).toBe('0x841fe4876763357975d60da128d8a54bb045d7664656661756c740000000000');
  });
});

describe('Appendix encoding', () => {
  it('matches the documented example: version 1, POST_ONLY order', () => {
    expect(encodeAppendix({ orderType: 3 })).toBe(1537n);
  });
});
