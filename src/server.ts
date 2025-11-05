import express, { Request, Response } from 'express';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 8080;

// Раздаём статику фронтенда
app.use(express.static(path.join(__dirname, '../output/dist')));

// Раздаём CSV файлы
app.use('/output', express.static(path.join(__dirname, '../output')));

// Для всех остальных маршрутов отдаём index.html (SPA)
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../output/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

