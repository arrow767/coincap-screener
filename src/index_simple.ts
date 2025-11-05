import { fetchPerpSymbols, fetchPerpPrices, fetchSpotSymbols, fetchAllSpotPrices } from './binance';
import { pickChainAndContract, fetchCoinDetails, CGCoinDetails, fetchCoinsList } from './coingecko';
import { parseBaseAsset, computePriceDiffPct } from './match';
import { loadConfig } from './config';
import { sleep } from './utils/http';
import pLimit from 'p-limit';
import { format } from 'date-fns';
import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs';

interface OutputRow {
	exchange_symbol: string;
	base_asset: string;
	multiplier: number;
	futures_price_usd: number;
	unit_price_from_futures_usd: number;
	onboard_days: number;
	has_spot: boolean;
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
}

async function main(): Promise<void> {
    const startedAt = Date.now();
    console.log('[start] Загрузка данных Binance...');
    const [perpSymbols, perpPrices, spotSymbols, spotPrices] = await Promise.all([
		fetchPerpSymbols(),
		fetchPerpPrices(),
        fetchSpotSymbols(),
        fetchAllSpotPrices(),
	]);

	const spotUSDTSet = new Set(
		spotSymbols
			.filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
			.map((s) => s.symbol)
	);

    console.log(`[info] Перпетуалов: ${perpSymbols.length}`);

    const config = loadConfig();
    console.log(`[config] concurrency=${config.concurrency}, priceTolerance=${config.priceTolerance}, outputDir=${config.outputDir}`);
    console.log(`[info] Доступных спот USDT-символов: ${spotUSDTSet.size}`);
    const limiter = pLimit(config.concurrency);
	const rows: OutputRow[] = [];

    const cgDetailsCache = new Map<string, CGCoinDetails>();
    const total = perpSymbols.length;
    let processed = 0;
    let matched = 0;
    let flaggedPrice = 0;
    let flaggedCap = 0;
    let flaggedFdv = 0;
    let flaggedOnboard = 0;
    let flaggedNoCg = 0;
    const progressTimer = setInterval(() => {
        console.log(`[progress] ${processed}/${total} обработано, совпадений=${matched}; флаги: price=${flaggedPrice}, cap=${flaggedCap}, fdv=${flaggedFdv}, days=${flaggedOnboard}, cg=${flaggedNoCg}`);
    }, config.progressIntervalMs);

    console.log('[info] Загружаю список монет CoinGecko...');
    const coinList = await fetchCoinsList();
    console.log(`[info] В списке CoinGecko монет: ${coinList.length}`);
    const symbolToCoins = new Map<string, { id: string; symbol: string; name: string }[]>();
    for (const c of coinList) {
        const arr = symbolToCoins.get(c.symbol) || [];
        arr.push({ id: c.id, symbol: c.symbol, name: c.name });
        symbolToCoins.set(c.symbol, arr);
    }
    console.log('[info] Начинаю обработку перпетуалов (с задержками для CoinGecko)...');

    let lastCgCallTime = 0;

	await Promise.all(
        perpSymbols.map((sym) =>
            limiter(async () => {
                try {
				const { baseNormalized, multiplier } = parseBaseAsset(sym.baseAsset);
                const futPrice = perpPrices[sym.symbol];
                if (!Number.isFinite(futPrice)) { processed++; return; }
				const unitFutPrice = futPrice / multiplier;
				const now = Date.now();
				const onboardDays = sym.onboardDate > 0 ? Math.floor((now - sym.onboardDate) / 86_400_000) : -1;

				const spotSymbol = `${baseNormalized}USDT`;
				const hasSpot = spotUSDTSet.has(spotSymbol);
                const spotPrice = hasSpot ? (spotPrices[spotSymbol] ?? null) : null;

                let cgId: string | null = null;
				let cgSymbol: string | null = null;
				let cgName: string | null = null;
				let cgPrice: number | null = null;
				let marketCap: number | null = null;
				let fdv: number | null = null;
				let chain: string | null = null;
				let contract: string | null = null;
				let priceDiffPct: number | null = null;

                let cgOk = false;
                try {
                    const group = symbolToCoins.get(baseNormalized.toLowerCase()) || [];
                    if (group.length > 0) {
                        const candidate = group[0];
                        let details = cgDetailsCache.get(candidate.id);
                        if (!details) {
                            const elapsed = Date.now() - lastCgCallTime;
                            if (elapsed < 300) await sleep(300 - elapsed);
                            details = await fetchCoinDetails(candidate.id);
                            cgDetailsCache.set(candidate.id, details);
                            lastCgCallTime = Date.now();
                        }
                        cgId = details.id;
                        cgSymbol = details.symbol;
                        cgName = details.name;
                        const md = details.market_data;
                        cgPrice = md?.current_price?.usd ?? null;
                        marketCap = md?.market_cap?.usd ?? null;
                        fdv = md?.fully_diluted_valuation?.usd ?? null;
                        const picked = pickChainAndContract(details.platforms || {});
                        chain = picked.chain;
                        contract = picked.contract;
                        if (cgPrice != null) {
                            priceDiffPct = computePriceDiffPct(unitFutPrice, cgPrice);
                            cgOk = true;
                        }
                    }
                } catch (e: any) {
                    // null если не получилось
                }

                const priceOk = cgPrice != null ? computePriceDiffPct(unitFutPrice, cgPrice) <= config.priceTolerance : false;
                if (!cgOk || cgPrice == null) flaggedNoCg++; else if (!priceOk) flaggedPrice++;

				const { filters } = config;
                let filterReason: string | null = null;
                if (filters.minOnboardDays !== undefined && onboardDays >= 0 && onboardDays < filters.minOnboardDays) { flaggedOnboard++; filterReason = (filterReason ? filterReason + ';' : '') + `onboard<${filters.minOnboardDays}`; }
                if (filters.maxOnboardDays !== undefined && onboardDays >= 0 && onboardDays > filters.maxOnboardDays) { flaggedOnboard++; filterReason = (filterReason ? filterReason + ';' : '') + `onboard>${filters.maxOnboardDays}`; }
                if (filters.minMarketCapUsd !== undefined) {
                    if (marketCap == null || marketCap < filters.minMarketCapUsd) { flaggedCap++; filterReason = (filterReason ? filterReason + ';' : '') + `mcap<${filters.minMarketCapUsd}`; }
                }
                if (filters.maxMarketCapUsd !== undefined) {
                    if (marketCap == null || marketCap > filters.maxMarketCapUsd) { flaggedCap++; filterReason = (filterReason ? filterReason + ';' : '') + `mcap>${filters.maxMarketCapUsd}`; }
                }
                if (filters.minFdvUsd !== undefined) {
                    if (fdv == null || fdv < filters.minFdvUsd) { flaggedFdv++; filterReason = (filterReason ? filterReason + ';' : '') + `fdv<${filters.minFdvUsd}`; }
                }
                if (filters.maxFdvUsd !== undefined) {
                    if (fdv == null || fdv > filters.maxFdvUsd) { flaggedFdv++; filterReason = (filterReason ? filterReason + ';' : '') + `fdv>${filters.maxFdvUsd}`; }
                }

                rows.push({
					exchange_symbol: sym.symbol,
					base_asset: sym.baseAsset,
					multiplier,
					futures_price_usd: futPrice,
					unit_price_from_futures_usd: unitFutPrice,
					onboard_days: onboardDays,
					has_spot: hasSpot,
					spot_symbol: hasSpot ? spotSymbol : null,
					spot_price_usd: spotPrice,
					coingecko_id: cgId,
					coingecko_symbol: cgSymbol,
					coingecko_name: cgName,
					coingecko_price_usd: cgPrice,
					price_diff_pct: priceDiffPct,
					market_cap_usd: marketCap,
					fdv_usd: fdv,
					chain,
					contract,
                    match_status: !cgOk || cgPrice == null ? 'cg_not_found' : priceOk ? 'matched' : 'price_too_far',
                    filter_reason: filterReason,
				});
                if (cgOk && priceOk) matched++;
                processed++;
                } catch (err) {
                    console.warn(`[warn] Ошибка обработки ${sym.symbol}:`, (err as Error)?.message ?? err);
                    processed++;
                }
			})
		)
	);

	const dateStr = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    fs.mkdirSync(config.outputDir, { recursive: true });
    const path = `${config.outputDir}/perp_screener_${dateStr}.csv`;
	const csvWriter = createObjectCsvWriter({
		path,
		header: [
			{ id: 'exchange_symbol', title: 'binance_symbol' },
			{ id: 'base_asset', title: 'base_asset' },
			{ id: 'multiplier', title: 'multiplier' },
			{ id: 'futures_price_usd', title: 'futures_price_usd' },
			{ id: 'unit_price_from_futures_usd', title: 'unit_price_from_futures_usd' },
			{ id: 'onboard_days', title: 'perp_onboard_days' },
			{ id: 'has_spot', title: 'has_spot_usdt' },
			{ id: 'spot_symbol', title: 'spot_symbol' },
			{ id: 'spot_price_usd', title: 'spot_price_usd' },
			{ id: 'coingecko_id', title: 'coingecko_id' },
			{ id: 'coingecko_symbol', title: 'coingecko_symbol' },
			{ id: 'coingecko_name', title: 'coingecko_name' },
			{ id: 'coingecko_price_usd', title: 'coingecko_price_usd' },
			{ id: 'price_diff_pct', title: 'price_diff_pct' },
			{ id: 'market_cap_usd', title: 'market_cap_usd' },
			{ id: 'fdv_usd', title: 'fdv_usd' },
			{ id: 'chain', title: 'chain' },
			{ id: 'contract', title: 'contract' },
			{ id: 'match_status', title: 'match_status' },
			{ id: 'filter_reason', title: 'filter_reason' },
		],
	});

    await csvWriter.writeRecords(rows);
    clearInterval(progressTimer);
    const ms = Date.now() - startedAt;
    console.log(`[done] Готово за ${(ms/1000).toFixed(1)}s. Совпадений: ${rows.length} из ${total}. CSV: ${path}`);
    console.log(`[summary] Флаги: price=${flaggedPrice}, cap=${flaggedCap}, fdv=${flaggedFdv}, days=${flaggedOnboard}, cg=${flaggedNoCg}`);
}

main().catch((e) => {
	console.error('[fatal] Ошибка выполнения:', e);
	process.exit(1);
});

