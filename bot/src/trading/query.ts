import axios from 'axios';
import { ENV } from '../config/env';

const headers = { 'Accept-Encoding': 'gzip, br, deflate' };

export async function getSubaccountInfo(sender: string) {
  const payload = { type: 'subaccount_info', subaccount: sender };
  const response = await axios.post(`${ENV.NADO_GATEWAY_URL}/query`, payload, { headers });
  return response.data;
}

export async function getOpenOrders(sender: string) {
  const payload = { type: 'subaccount_orders', subaccount: sender };
  const response = await axios.post(`${ENV.NADO_GATEWAY_URL}/query`, payload, { headers });
  return response.data;
}
