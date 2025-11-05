import { createHttpClient, getJson } from './utils/http';

const fapi = createHttpClient('https://fapi.binance.com'); // USD-M futures
const sapi = createHttpClient('https://api.binance.com'); // spot

export interface BinancePerpSymbolInfo {
	symbol: string;
	baseAsset: string;
	quoteAsset: string;
	onboardDate: number; // ms epoch
}

export interface BinanceSpotInfo {
	symbol: string;
	status: string;
	baseAsset: string;
	quoteAsset: string;
}

export async function fetchPerpSymbols(): Promise<BinancePerpSymbolInfo[]> {
	// https://fapi.binance.com/fapi/v1/exchangeInfo
	const data = await getJson<any>(fapi, '/fapi/v1/exchangeInfo');
	const result: BinancePerpSymbolInfo[] = (data.symbols || [])
		.filter((s: any) => s.contractType === 'PERPETUAL' && s.status === 'TRADING' && s.quoteAsset === 'USDT')
		.map((s: any) => ({
			symbol: s.symbol as string,
			baseAsset: s.baseAsset as string,
			quoteAsset: s.quoteAsset as string,
			onboardDate: Number(s.onboardDate) || 0,
		}));
	return result;
}

export async function fetchPerpPrices(): Promise<Record<string, number>> {
	// https://fapi.binance.com/fapi/v1/ticker/price
	const arr = await getJson<Array<{ symbol: string; price: string }>>(fapi, '/fapi/v1/ticker/price');
	const map: Record<string, number> = {};
	for (const it of arr) {
		const p = Number(it.price);
		if (!Number.isFinite(p)) continue;
		map[it.symbol] = p;
	}
	return map;
}

export async function fetchSpotSymbols(): Promise<BinanceSpotInfo[]> {
	// https://api.binance.com/api/v3/exchangeInfo
	const data = await getJson<any>(sapi, '/api/v3/exchangeInfo');
	return (data.symbols || []).map((s: any) => ({
		symbol: s.symbol as string,
		status: s.status as string,
		baseAsset: s.baseAsset as string,
		quoteAsset: s.quoteAsset as string,
	}));
}

export async function fetchSpotPrice(symbol: string): Promise<number | null> {
	try {
		const obj = await getJson<{ symbol: string; price: string }>(sapi, `/api/v3/ticker/price?symbol=${symbol}`);
		const p = Number(obj.price);
		return Number.isFinite(p) ? p : null;
	} catch {
		return null;
	}
}

export async function fetchAllSpotPrices(): Promise<Record<string, number>> {
	// https://api.binance.com/api/v3/ticker/price
	const arr = await getJson<Array<{ symbol: string; price: string }>>(sapi, '/api/v3/ticker/price');
	const map: Record<string, number> = {};
	for (const it of arr) {
		const p = Number(it.price);
		if (!Number.isFinite(p)) continue;
		map[it.symbol] = p;
	}
	return map;
}


