# Изменения от 2025-11-19: Автоматическое обновление данных

## Что изменилось

Теперь бэкенд **автоматически обновляет** данные монет (цены, market cap, FDV и т.д.) периодически, без необходимости ручного запуска или настройки cron.

## Основные изменения

### 1. Автоматическое обновление данных на сервере

- **Периодическое обновление**: Сервер автоматически запускает сбор данных каждые 5 минут (по умолчанию)
- **Обновление при старте**: При запуске сервера данные собираются сразу
- **Настраиваемый интервал**: Можно изменить через `config.json` или переменную окружения

### 2. Новые возможности

- ✅ API endpoint `/api/latest-data` - проверка времени последнего обновления
- ✅ API endpoint `/api/refresh` - принудительное обновление данных (POST запрос)
- ✅ Graceful shutdown - корректная остановка при завершении процесса
- ✅ Защита от одновременных обновлений

### 3. Измененные файлы

- `src/server.ts` - добавлена логика периодического обновления
- `src/index.ts` - основная функция теперь экспортируется и может вызываться многократно
- `src/config.ts` - добавлен параметр `updateIntervalMs`
- `config.json` и `config.example.json` - добавлен параметр `updateIntervalMs`

## Как использовать

### Запуск в production

**Простой способ:**

```bash
npm run build:all
npm run start:prod
```

Всё! Сервер будет:
- Собирать данные при старте
- Обновлять данные каждые 5 минут
- Отдавать веб-интерфейс на http://localhost:8080

### Настройка интервала обновления

**Через config.json:**

```json
{
  "updateIntervalMs": 600000  // 10 минут (в миллисекундах)
}
```

**Через переменную окружения:**

```bash
UPDATE_INTERVAL_MS=600000 npm run start:prod
```

**Рекомендуемые значения:**
- 300000 (5 минут) - по умолчанию
- 600000 (10 минут) - для снижения нагрузки на API
- 900000 (15 минут) - для минимальной нагрузки

### API endpoints

**Проверка последнего обновления:**

```bash
curl http://localhost:8080/api/latest-data
```

Ответ:
```json
{
  "exists": true,
  "lastModified": "2025-11-19T10:30:00.000Z",
  "path": "/output/perp_screener_latest.csv"
}
```

**Принудительное обновление:**

```bash
curl -X POST http://localhost:8080/api/refresh
```

Ответ:
```json
{
  "success": true,
  "message": "Data refreshed successfully"
}
```

## Миграция с предыдущей версии

Если вы использовали cron или PM2 с расписанием:

### Было (старый способ):

```bash
# PM2 с cron
pm2 start dist/index.js --name screener --cron "0 * * * *" --no-autorestart
pm2 start dist/server.js --name web
```

### Стало (новый способ):

```bash
# Просто запускаем сервер
pm2 start dist/server.js --name coincap-screener
pm2 save
```

**Удалите** старые cron задачи и PM2 процессы со скринером!

## Деплой

### PM2

```bash
npm run build:all
pm2 start dist/server.js --name coincap-screener
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build:all
EXPOSE 8080
ENV UPDATE_INTERVAL_MS=300000
CMD ["node", "dist/server.js"]
```

### systemd

Создайте `/etc/systemd/system/coincap-screener.service`:

```ini
[Unit]
Description=Binance Perpetual Screener
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/coincap_screener
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=UPDATE_INTERVAL_MS=300000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable coincap-screener
sudo systemctl start coincap-screener
```

## Troubleshooting

### Данные не обновляются

Проверьте логи:

```bash
# PM2
pm2 logs coincap-screener

# systemd
sudo journalctl -u coincap-screener -f

# Docker
docker logs -f <container-id>
```

Должны быть строки вида:
```
[scheduler] Начинаем периодическое обновление данных...
[start] Загрузка данных Binance...
[done] Готово за X.Xs. Всего строк: XXX
```

### Слишком частые обновления

Увеличьте `updateIntervalMs` в `config.json`:

```json
{
  "updateIntervalMs": 900000  // 15 минут
}
```

### Ошибки 429 (Too Many Requests) от CoinGecko

- Уменьшите `concurrency` в config.json (например, до 2-3)
- Добавьте прокси в `proxy.txt`
- Увеличьте `updateIntervalMs` до 10-15 минут

## Разработка

При разработке можно запускать отдельно:

```bash
# Только сбор данных (без автообновления)
npm run start

# Только сервер с автообновлением
npm run start:server
```

## Вопросы и поддержка

Если возникли проблемы:

1. Проверьте логи сервера
2. Убедитесь, что папка `output/` существует и доступна для записи
3. Проверьте `config.json` на корректность
4. Убедитесь, что нет старых cron задач или PM2 процессов, которые конфликтуют

---

**Автор**: AI Assistant  
**Дата**: 2025-11-19  
**Версия**: 1.0.0

