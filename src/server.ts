import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { runDataCollection } from './index';
import { loadConfig } from './config';

const app = express();
const PORT = process.env.PORT || 8080;

// In-memory storage для Railway (ephemeral filesystem)
let latestData: any[] = [];
let lastUpdateTime: Date | null = null;

export function updateInMemoryData(data: any[]) {
  latestData = data;
  lastUpdateTime = new Date();
  console.log(`[server] Обновлены данные в памяти: ${data.length} записей`);
}

// Раздаём статику фронтенда
app.use(express.static(path.join(__dirname, '../output/dist')));

// Раздаём CSV файлы (только если запущено локально, не на Railway)
const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined;
if (!isRailway) {
  app.use('/output', express.static(path.join(__dirname, '../output')));
}

// API endpoint для получения данных (для Railway)
app.get('/api/data', (req: Request, res: Response) => {
  try {
    if (latestData.length === 0) {
      return res.status(503).json({ 
        error: 'Data not ready yet',
        message: 'Данные еще собираются, попробуйте через минуту'
      });
    }
    
    // Конвертируем в CSV формат
    const headers = [
      'binance_symbol', 'base_asset', 'multiplier', 'futures_price_usd',
      'unit_price_from_futures_usd', 'perp_onboard_days', 'has_spot_usdt',
      'spot_symbol', 'spot_price_usd', 'coingecko_id', 'coingecko_symbol',
      'coingecko_name', 'coingecko_price_usd', 'price_diff_pct',
      'market_cap_usd', 'fdv_usd', 'chain', 'contract', 'match_status', 'filter_reason'
    ];
    
    const csvLines = [headers.join(',')];
    latestData.forEach(row => {
      const line = headers.map(h => {
        const val = (row as any)[h];
        return val == null ? '' : String(val);
      }).join(',');
      csvLines.push(line);
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="perp_screener_latest.csv"');
    res.send(csvLines.join('\n'));
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API endpoint для получения последних данных
app.get('/api/latest-data', (req: Request, res: Response) => {
  try {
    if (isRailway) {
      // На Railway используем in-memory данные
      res.json({
        exists: latestData.length > 0,
        lastModified: lastUpdateTime,
        path: '/api/data',
        count: latestData.length,
        inMemory: true
      });
    } else {
      // Локально используем файлы
      const config = loadConfig();
      const outputDir = path.join(__dirname, '..', config.outputDir);
      const latestFile = path.join(outputDir, 'perp_screener_latest.csv');
      
      if (fs.existsSync(latestFile)) {
        const stats = fs.statSync(latestFile);
        res.json({
          exists: true,
          lastModified: stats.mtime,
          path: '/output/perp_screener_latest.csv',
          inMemory: false
        });
      } else {
        res.json({ exists: false, inMemory: false });
      }
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API endpoint для принудительного обновления данных
app.post('/api/refresh', async (req: Request, res: Response) => {
  try {
    console.log('[api] Запрос на принудительное обновление данных...');
    const data = await runDataCollection();
    updateInMemoryData(data);
    res.json({ success: true, message: 'Data refreshed successfully', count: data.length });
  } catch (e) {
    console.error('[api] Ошибка при обновлении:', e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// Для всех остальных маршрутов отдаём index.html (SPA)
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../output/dist/index.html'));
});

// Переменная для хранения интервала
let updateInterval: NodeJS.Timeout | null = null;
let isUpdating = false;

// Функция для периодического обновления данных
async function updateDataPeriodically() {
  if (isUpdating) {
    console.log('[scheduler] Предыдущее обновление ещё выполняется, пропускаем...');
    return;
  }

  isUpdating = true;
  try {
    console.log('[scheduler] Начинаем периодическое обновление данных...');
    const data = await runDataCollection();
    updateInMemoryData(data);
    console.log('[scheduler] Данные успешно обновлены');
  } catch (e) {
    console.error('[scheduler] Ошибка при обновлении данных:', e);
  } finally {
    isUpdating = false;
  }
}

// Запуск сервера с периодическим обновлением
async function startServer() {
  // Первоначальное обновление данных при запуске
  console.log('[server] Первоначальное обновление данных при запуске...');
  await updateDataPeriodically();

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    
    // Настройка периодического обновления
    const config = loadConfig();
    const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS || String(config.updateIntervalMs || 300000));
    console.log(`[scheduler] Настроено автообновление каждые ${UPDATE_INTERVAL_MS / 1000} секунд (${(UPDATE_INTERVAL_MS / 60000).toFixed(1)} минут)`);
    
    updateInterval = setInterval(updateDataPeriodically, UPDATE_INTERVAL_MS);
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM получен, останавливаем сервер...');
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT получен, останавливаем сервер...');
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  process.exit(0);
});

startServer().catch((e) => {
  console.error('[server] Ошибка запуска сервера:', e);
  process.exit(1);
});
