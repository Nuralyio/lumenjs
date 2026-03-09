#!/usr/bin/env node
import path from 'path';

const args = process.argv.slice(2);
const command = args[0];

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const USAGE = `Usage:
  lumenjs create <name> [--template <default|blog|dashboard>]
  lumenjs dev    [--project <dir>] [--port <port>] [--base <path>] [--editor-mode]
  lumenjs build  [--project <dir>] [--out <dir>]
  lumenjs serve  [--project <dir>] [--port <port>]
  lumenjs add    <integration>`;

if (!command || !['create', 'dev', 'build', 'serve', 'add'].includes(command)) {
  console.error(USAGE);
  process.exit(1);
}

const projectDir = path.resolve(getArg('project') || '.');

async function main() {
  if (command === 'create') {
    const { createProject } = await import('./create.js');
    const name = args[1];
    const template = getArg('template') || 'default';
    await createProject(name, template);
    return;
  } else if (command === 'dev') {
    const { createDevServer } = await import('./dev-server/server.js');
    const port = parseInt(getArg('port') || '3000', 10);
    const editorMode = args.includes('--editor-mode');
    const base = getArg('base') || '/';

    console.log(`[LumenJS] Starting dev server...`);
    console.log(`  Project: ${projectDir}`);
    console.log(`  Port: ${port}`);
    if (base !== '/') console.log(`  Base: ${base}`);
    console.log(`  Editor mode: ${editorMode}`);

    const server = await createDevServer({ projectDir, port, editorMode, base });
    await server.listen();

    const address = server.httpServer?.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`[LumenJS] Dev server running at http://localhost:${actualPort}`);
  } else if (command === 'build') {
    const { buildProject } = await import('./build/build.js');
    const outDir = getArg('out');

    console.log(`[LumenJS] Starting production build...`);
    console.log(`  Project: ${projectDir}`);
    if (outDir) console.log(`  Output: ${outDir}`);

    await buildProject({ projectDir, outDir });
  } else if (command === 'add') {
    const integration = args[1];
    const { addIntegration } = await import('./integrations/add.js');
    await addIntegration(projectDir, integration);
  } else if (command === 'serve') {
    const { serveProject } = await import('./build/serve.js');
    const port = parseInt(getArg('port') || '3000', 10);

    console.log(`[LumenJS] Starting production server...`);
    console.log(`  Project: ${projectDir}`);
    console.log(`  Port: ${port}`);

    await serveProject({ projectDir, port });
  }
}

main().catch(err => {
  console.error('[LumenJS] Failed to start:', err);
  process.exit(1);
});
