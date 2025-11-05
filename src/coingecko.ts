import { createHttpClient, getJson, withRetry } from './utils/http';
import { getNextProxy } from './proxy';
import { HttpsProxyAgent } from 'https-proxy-agent';

let cgClients: { client: any; proxy: string | null }[] = [];

function getCgClient(): any {
	if (cgClients.length === 0) {
		const proxy = getNextProxy();
		const client = createHttpClient('https://api.coingecko.com/api/v3', 15000, proxy?.agent);
		return client;
	}
	const idx = Math.floor(Math.random() * cgClients.length);
	return cgClients[idx].client;
}

export function initCgClients(proxyCount: number): void {
	cgClients = [];
	if (proxyCount === 0) {
		cgClients.push({ client: createHttpClient('https://api.coingecko.com/api/v3'), proxy: null });
	} else {
		for (let i = 0; i < proxyCount; i++) {
			const proxy = getNextProxy();
			const client = createHttpClient('https://api.coingecko.com/api/v3', 15000, proxy?.agent);
			cgClients.push({ client, proxy: proxy?.url || null });
		}
	}
	console.log(`[coingecko] Инициализировано ${cgClients.length} клиентов (с прокси: ${cgClients.filter(c => c.proxy).length})`);
}

export interface CGSearchResultCoin {
	id: string;
	name: string;
	symbol: string; // lower-case typically
	market_cap_rank: number | null;
}

export interface CGCoinDetails {
	id: string;
	symbol: string;
	name: string;
	market_data: {
		current_price: { usd?: number };
		market_cap: { usd?: number };
		fully_diluted_valuation: { usd?: number } | null;
	} | null;
	platforms?: Record<string, string | null>;
}

export interface CGMarketRow {
	id: string;
	symbol: string;
	name: string;
	current_price: number | null;
	market_cap: number | null;
	fully_diluted_valuation: number | null;
}

export interface CGCoinListItem {
	id: string;
	symbol: string; // lower-case
	name: string;
}

export async function searchCoins(query: string): Promise<CGSearchResultCoin[]> {
	const client = getCgClient();
	const data = await withRetry(() => getJson<any>(client, `/search?query=${encodeURIComponent(query)}`), 3, 600);
	return (data.coins || []) as CGSearchResultCoin[];
}

export async function fetchCoinDetails(id: string): Promise<CGCoinDetails> {
	const client = getCgClient();
	return await withRetry(
		() =>
			getJson<CGCoinDetails>(
				client,
				`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`
			),
		3,
		800
	);
}

export function pickBestCoinCandidate(baseSymbol: string, candidates: CGSearchResultCoin[]): CGSearchResultCoin | null {
	const sym = baseSymbol.toLowerCase();
	const exact = candidates.filter((c) => c.symbol.toLowerCase() === sym);
	const pool = exact.length > 0 ? exact : candidates;
	if (pool.length === 0) return null;
	// prefer smallest non-null market_cap_rank
	return (
		pool
			.slice()
			.sort((a, b) => {
				const ra = a.market_cap_rank ?? Number.POSITIVE_INFINITY;
				const rb = b.market_cap_rank ?? Number.POSITIVE_INFINITY;
				return ra - rb;
			})[0] || null
	);
}

const CHAIN_PRIORITY = [
	'ethereum',
	'binance-smart-chain',
	'arbitrum-one',
	'optimistic-ethereum',
	'solana',
	'polygon-pos',
	'base',
	'avalanche',
	'tron',
	'fantom',
	'linea',
	'opbnb',
];

export function pickChainAndContract(platforms: Record<string, string | null> | undefined): { chain: string | null; contract: string | null } {
	if (!platforms) return { chain: null, contract: null };
	for (const chain of CHAIN_PRIORITY) {
		const addr = platforms[chain];
		if (addr && String(addr).trim().length > 0) {
			return { chain, contract: String(addr) };
		}
	}
	// fallback: first non-empty
	for (const [chain, addr] of Object.entries(platforms)) {
		if (addr && String(addr).trim().length > 0) {
			return { chain, contract: String(addr) };
		}
	}
	return { chain: null, contract: null };
}

export async function fetchMarketsByIds(ids: string[]): Promise<Record<string, CGMarketRow>> {
    if (ids.length === 0) return {};
    const out: Record<string, CGMarketRow> = {};
    const chunks: string[][] = [];
    const size = 100;
    for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
    for (const chunk of chunks) {
        const client = getCgClient();
        const url = `/coins/markets?vs_currency=usd&ids=${encodeURIComponent(chunk.join(','))}&order=market_cap_desc&per_page=${chunk.length}&page=1&sparkline=false&price_change_percentage=`;
        const arr = await withRetry(() => getJson<any[]>(client, url), 6, 1500);
        for (const row of arr) {
            out[row.id] = {
                id: row.id,
                symbol: row.symbol,
                name: row.name,
                current_price: typeof row.current_price === 'number' ? row.current_price : null,
                market_cap: typeof row.market_cap === 'number' ? row.market_cap : null,
                fully_diluted_valuation: typeof row.fully_diluted_valuation === 'number' ? row.fully_diluted_valuation : null,
            };
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    return out;
}

export async function fetchCoinsList(): Promise<CGCoinListItem[]> {
	const client = getCgClient();
	return await withRetry(() => getJson<CGCoinListItem[]>(client, `/coins/list?include_platform=false`), 3, 800);
}


