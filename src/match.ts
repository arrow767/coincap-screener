export interface ParsedBase {
	baseNormalized: string;
	multiplier: number;
}

export function parseBaseAsset(baseAsset: string): ParsedBase {
	const m = baseAsset.match(/^(\d+)([A-Z].*)$/);
	if (m) {
		return { baseNormalized: m[2], multiplier: Number(m[1]) };
	}
	return { baseNormalized: baseAsset, multiplier: 1 };
}

export function computePriceDiffPct(a: number, b: number): number {
	if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return Number.POSITIVE_INFINITY;
	return Math.abs(a - b) / Math.abs(b);
}


