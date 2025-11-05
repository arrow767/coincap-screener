import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function createHttpClient(baseURL?: string, timeoutMs: number = 15000, proxyAgent?: HttpsProxyAgent<string>): AxiosInstance {
	const instance = axios.create({ 
		baseURL, 
		timeout: timeoutMs,
		...(proxyAgent ? { httpsAgent: proxyAgent, proxy: false } : {})
	});
	instance.interceptors.response.use(
		(resp) => resp,
		(err) => {
			if (err.response) return Promise.reject(err);
			return Promise.reject(err);
		}
	);
	return instance;
}

export async function withRetry<T>(fn: () => Promise<T>, retries: number = 3, baseDelayMs: number = 500): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            let delay = baseDelayMs * Math.pow(2, attempt);
            const status = err?.response?.status as number | undefined;
            const ra = err?.response?.headers?.['retry-after'];
            if (status === 429) {
                const raSec = ra ? Number(ra) : NaN;
                const raMs = Number.isFinite(raSec) ? raSec * 1000 : 0;
                delay = Math.max(delay, raMs || baseDelayMs);
            } else if (status && status >= 500) {
                delay = Math.max(delay, baseDelayMs * 2);
            }
            if (attempt === retries) break;
            await sleep(delay);
        }
    }
    throw lastErr;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getJson<T>(client: AxiosInstance, url: string, config?: AxiosRequestConfig): Promise<T> {
	const resp = await client.get<T>(url, config);
	return resp.data as T;
}


