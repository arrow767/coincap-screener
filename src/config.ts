import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const numberOrUndefined = (schema: z.ZodNumber) =>
    z.preprocess((v) => (v === null ? undefined : v), schema.optional());

const ConfigSchema = z.object({
	concurrency: z.number().int().positive().max(32).default(4),
	priceTolerance: z.number().positive().max(1).default(0.2),
	progressIntervalMs: z.number().int().positive().max(600000).default(5000),
	chainsPriority: z.array(z.string()).default([
		'ethereum',
		'binance-smart-chain',
		'arbitrum-one',
		'optimistic-ethereum',
		'solana',
		'polygon-pos',
		'base',
		'avalanche',
	]),
    filters: z
        .object({
            minMarketCapUsd: numberOrUndefined(z.number().nonnegative()),
            maxMarketCapUsd: numberOrUndefined(z.number().positive()),
            minFdvUsd: numberOrUndefined(z.number().nonnegative()),
            maxFdvUsd: numberOrUndefined(z.number().positive()),
            minOnboardDays: numberOrUndefined(z.number().int().nonnegative()),
            maxOnboardDays: numberOrUndefined(z.number().int().positive()),
        })
        .default({}),
	outputDir: z.string().default('output'),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(): AppConfig {
	const configPath = path.resolve(process.cwd(), 'config.json');
	let raw: unknown = {};
	if (fs.existsSync(configPath)) {
		try {
			const txt = fs.readFileSync(configPath, 'utf8');
			raw = JSON.parse(txt);
		} catch (e) {
			throw new Error(`Ошибка чтения config.json: ${(e as Error).message}`);
		}
	}
	const parsed = ConfigSchema.safeParse(raw ?? {});
	if (!parsed.success) {
		throw new Error(`Неверный config.json: ${parsed.error.toString()}`);
	}
	return parsed.data;
}


