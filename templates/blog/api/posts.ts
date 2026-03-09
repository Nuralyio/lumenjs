import { useDb } from '@nuraly/lumenjs/db';

export function GET() {
  const db = useDb();
  const posts = db.all('SELECT id, title, slug, content, date FROM posts ORDER BY date DESC');
  return { posts };
}

export function POST(req: { body: any }) {
  const { title, slug, content } = req.body;
  if (!title || !slug || !content) {
    throw { status: 400, message: 'title, slug, and content are required' };
  }
  const db = useDb();
  const result = db.run(
    'INSERT INTO posts (title, slug, content) VALUES (?, ?, ?)',
    title, slug, content
  );
  return { id: result.lastInsertRowid, title, slug, content };
}
