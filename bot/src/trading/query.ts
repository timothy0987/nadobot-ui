import axios from 'axios';
import { ENV } from '../config/env';

const headers = { 'Accept-Encoding': 'gzip, br, deflate' };

export async function getSubaccountInfo(sender: string) {
  const payload = { type: 'subaccount_info', subaccount: sender };
  const response = await axios.post(`${ENV.NADO_GATEWAY_URL}/query`, payload, { headers });
  return response.data;
}

/** Unlike subaccount_info, this query takes `sender` (not `subaccount`) and requires a product_id. */
export async function getOpenOrders(sender: string, productId: number) {
  const payload = { type: 'subaccount_orders', sender, product_id: productId };
  const response = await axios.post(`${ENV.NADO_GATEWAY_URL}/query`, payload, { headers });
  return response.data;
}
