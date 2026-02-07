/**
 * Fetch current price for an asset (for resolution).
 */
const COINGECKO_IDS = {
  ETHUSD: 'ethereum',
  BTCUSD: 'bitcoin',
  SOLUSD: 'solana',
  MATICUSD: 'matic-network',
};

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';

export async function fetchCurrentPrice(asset = 'ETHUSD') {
  const geckoId = COINGECKO_IDS[asset.toUpperCase()];
  if (!geckoId) return null;
  try {
    const url = `${COINGECKO_URL}?ids=${geckoId}&vs_currencies=usd`;
    const res = await fetch(url);
    const data = await res.json();
    const price = data[geckoId]?.usd;
    return price != null ? { asset, price, source: 'coingecko' } : null;
  } catch (err) {
    return null;
  }
}
