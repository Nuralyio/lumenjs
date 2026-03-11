export function generateI18nKey(sourceFile: string, tag: string, text: string): string {
  const basename = sourceFile.split('/').pop()?.replace(/\.\w+$/, '') || 'page';
  const slug = text.substring(0, 30).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return `${basename}.${tag}.${slug}`;
}
