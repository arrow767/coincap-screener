import fs from 'fs';
import path from 'path';
import { HttpsProxyAgent } from 'https-proxy-agent';

export interface ProxyConfig {
	url: string;
	agent: HttpsProxyAgent<string>;
}

let proxyPool: ProxyConfig[] = [];
let currentIndex = 0;

export function loadProxies(): ProxyConfig[] {
	const proxyPath = path.resolve(process.cwd(), 'proxy.txt');
	if (!fs.existsSync(proxyPath)) {
		console.log('[proxy] proxy.txt не найден, работаем без прокси');
		return [];
	}
	const lines = fs.readFileSync(proxyPath, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
	proxyPool = lines.map((url) => {
		const agent = new HttpsProxyAgent(url);
		return { url, agent };
	});
	console.log(`[proxy] Загружено прокси: ${proxyPool.length}`);
	return proxyPool;
}

export function getNextProxy(): ProxyConfig | null {
	if (proxyPool.length === 0) return null;
	const proxy = proxyPool[currentIndex % proxyPool.length];
	currentIndex++;
	return proxy;
}

export function getProxyCount(): number {
	return proxyPool.length;
}

