/**
 * Molty Events — Stork Oracle Price Feed
 *
 * Fetches live crypto prices from the Stork REST API.
 * https://docs.stork.network/api-reference/rest-api
 *
 * Environment variables:
 *   STORK_API_KEY — Stork API token (required)
 */

const STORK_BASE_URL = "https://rest.jp.stork-oracle.network";

interface StorkSignedPrice {
  price: string; // quantized: value * 10^18
  timestamped_signature: {
    timestamp: number; // UNIX nanoseconds
  };
}

interface StorkAssetPrice {
  asset_id: string;
  price: string; // quantized: value * 10^18
  timestamp: number;
  stork_signed_price?: StorkSignedPrice;
}

interface StorkPriceResponse {
  data: Record<string, StorkAssetPrice>;
}

interface PriceResult {
  asset: string;
  price: number;
  timestamp: Date;
}

/**
 * Fetch the latest price for one or more assets from Stork.
 *
 * @param assets - Comma-separated asset IDs, e.g. "BTCUSD,ETHUSD"
 * @returns Array of price results with human-readable USD values
 *
 * @example
 *   const prices = await fetchPrice("ETHUSD");
 *   // [{ asset: "ETHUSD", price: 3247.42, timestamp: Date }]
 *
 * @example
 *   const prices = await fetchPrice("BTCUSD,ETHUSD,SOLUSD");
 *   // [{ asset: "BTCUSD", price: 97450.12, ... }, ...]
 */
export async function fetchPrice(assets: string): Promise<PriceResult[]> {
  const apiKey = process.env.STORK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "STORK_API_KEY is not configured. Price feeds are unavailable."
    );
  }

  const url = `${STORK_BASE_URL}/v1/prices/latest?assets=${encodeURIComponent(assets.toUpperCase())}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${apiKey}`,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Stork API key is invalid or expired.");
    }
    if (response.status === 429) {
      throw new Error("Stork API rate limit reached. Try again in a moment.");
    }
    throw new Error(
      `Stork API error: ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as StorkPriceResponse;

  if (!body.data || Object.keys(body.data).length === 0) {
    throw new Error(
      `No pricing data found for: ${assets}. Check that the asset ID is valid (e.g. BTCUSD, ETHUSD).`
    );
  }

  const results: PriceResult[] = [];

  for (const [assetId, assetData] of Object.entries(body.data)) {
    // Price is quantized as value * 10^18 — divide to get USD
    const quantizedPrice = BigInt(assetData.price);
    const price = Number(quantizedPrice) / 1e18;

    // Timestamp is in nanoseconds — convert to milliseconds
    const timestampMs =
      assetData.timestamp > 1e15
        ? Math.floor(assetData.timestamp / 1e6) // nanoseconds -> ms
        : assetData.timestamp * 1000; // seconds -> ms

    results.push({
      asset: assetId,
      price: Math.round(price * 100) / 100, // round to 2 decimal places
      timestamp: new Date(timestampMs),
    });
  }

  return results;
}

/**
 * List all available asset IDs from Stork.
 * Useful for discovering which pairs are supported.
 */
export async function listAssets(): Promise<string[]> {
  const apiKey = process.env.STORK_API_KEY;
  if (!apiKey) {
    throw new Error("STORK_API_KEY is not configured.");
  }

  const url = `${STORK_BASE_URL}/v1/prices/assets`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Stork API error: ${response.status} ${response.statusText}`
    );
  }

  const body = (await response.json()) as { data: string[] };
  return body.data ?? [];
}
