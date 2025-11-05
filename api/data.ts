import { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs';
import path from 'path';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Для Vercel нужно использовать внешнее хранилище (S3, R2, Supabase Storage и т.д.)
    // или API endpoint, так как файловая система read-only
    
    // Временное решение: возвращаем сообщение
    return res.status(200).json({ 
      message: 'CSV data endpoint',
      note: 'For Vercel deployment, you need to store CSV files in external storage (S3, R2, etc.) or use a database'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
}

