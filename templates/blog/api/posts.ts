export function GET() {
  return Response.json([
    { slug: 'hello-world', title: 'Hello World' },
    { slug: 'getting-started', title: 'Getting Started with LumenJS' },
  ]);
}
