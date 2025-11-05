export interface CoinData {
  binance_symbol: string;
  base_asset: string;
  multiplier: number;
  futures_price_usd: number;
  unit_price_from_futures_usd: number;
  perp_onboard_days: number;
  has_spot_usdt: boolean;
  spot_symbol: string | null;
  spot_price_usd: number | null;
  coingecko_id: string | null;
  coingecko_symbol: string | null;
  coingecko_name: string | null;
  coingecko_price_usd: number | null;
  price_diff_pct: number | null;
  market_cap_usd: number | null;
  fdv_usd: number | null;
  chain: string | null;
  contract: string | null;
  match_status: 'matched' | 'price_too_far' | 'cg_not_found';
  filter_reason: string | null;
  price_change_24h?: number; // будем получать отдельно
  isNew?: boolean;
}

