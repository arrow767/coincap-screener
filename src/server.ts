import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { runDataCollection } from './index';
import { loadConfig } from './config';

const app = express();
const PORT = process.env.PORT || 8080;

// Раздаём статику фронтенда
app.use(express.static(path.join(__dirname, '../output/dist')));

// Раздаём CSV файлы
app.use('/output', express.static(path.join(__dirname, '../output')));

// API endpoint для получения последних данных
app.get('/api/latest-data', (req: Request, res: Response) => {
  try {
    const config = loadConfig();
    const outputDir = path.join(__dirname, '..', config.outputDir);
    const latestFile = path.join(outputDir, 'perp_screener_latest.csv');
    
    if (fs.existsSync(latestFile)) {
      const stats = fs.statSync(latestFile);
      res.json({
        exists: true,
        lastModified: stats.mtime,
        path: '/output/perp_screener_latest.csv'
      });
    } else {
      res.json({ exists: false });
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// API endpoint для принудительного обновления данных
app.post('/api/refresh', async (req: Request, res: Response) => {
  try {
    console.log('[api] Запрос на принудительное обновление данных...');
    await runDataCollection();
    res.json({ success: true, message: 'Data refreshed successfully' });
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
    await runDataCollection();
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
