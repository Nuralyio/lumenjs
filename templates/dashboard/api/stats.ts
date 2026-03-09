import { useDb } from '@nuraly/lumenjs/db';

export function GET() {
  const db = useDb();
  const stats = db.all('SELECT id, label, value, unit, updated_at FROM stats ORDER BY id');
  return { stats };
}
