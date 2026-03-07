import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const INTEGRATIONS: Record<string, {
  packages: string[];
  setup: (projectDir: string) => void;
  message: string;
}> = {
  tailwind: {
    packages: ['tailwindcss', '@tailwindcss/vite'],
    setup(projectDir: string) {
      const stylesDir = path.join(projectDir, 'styles');
      const cssPath = path.join(stylesDir, 'tailwind.css');
      if (!fs.existsSync(stylesDir)) {
        fs.mkdirSync(stylesDir, { recursive: true });
      }
      if (!fs.existsSync(cssPath)) {
        fs.writeFileSync(cssPath, '@import "tailwindcss";\n');
        console.log('  \u2713 Created styles/tailwind.css');
      } else {
        console.log('  \u2713 styles/tailwind.css already exists');
      }
    },
    message: `Tailwind CSS is ready. Use utility classes in light-DOM pages:
    createRenderRoot() { return this; }`,
  },
};

export async function addIntegration(projectDir: string, integration: string): Promise<void> {
  if (!integration) {
    console.error('Usage: lumenjs add <integration>');
    console.error(`Available integrations: ${Object.keys(INTEGRATIONS).join(', ')}`);
    process.exit(1);
  }

  const config = INTEGRATIONS[integration];
  if (!config) {
    console.error(`Unknown integration: ${integration}`);
    console.error(`Available integrations: ${Object.keys(INTEGRATIONS).join(', ')}`);
    process.exit(1);
  }

  console.log(`[LumenJS] Adding ${integration} integration...`);

  // Install packages into the project
  const pkgs = config.packages.join(' ');
  console.log(`  Installing ${pkgs}...`);
  try {
    execSync(`npm install ${pkgs}`, { cwd: projectDir, stdio: 'inherit' });
    console.log(`  \u2713 Installed ${config.packages.join(', ')}`);
  } catch {
    console.error(`  \u2717 Failed to install packages. Make sure npm is available.`);
    process.exit(1);
  }

  // Run integration-specific setup
  config.setup(projectDir);

  // Update lumenjs.config.ts
  updateConfig(projectDir, integration);

  console.log('');
  console.log(`  ${config.message}`);
}

function updateConfig(projectDir: string, integration: string): void {
  const configPath = path.join(projectDir, 'lumenjs.config.ts');

  if (!fs.existsSync(configPath)) {
    // Create config file with the integration
    fs.writeFileSync(configPath, `export default {
  integrations: ['${integration}'],
};
`);
    console.log('  \u2713 Created lumenjs.config.ts');
    return;
  }

  let content = fs.readFileSync(configPath, 'utf-8');

  // Check if integrations array already exists
  const integrationsMatch = content.match(/integrations\s*:\s*\[([^\]]*)\]/);
  if (integrationsMatch) {
    const existing = integrationsMatch[1];
    // Check if already included
    if (existing.includes(`'${integration}'`) || existing.includes(`"${integration}"`)) {
      console.log(`  \u2713 lumenjs.config.ts already includes '${integration}'`);
      return;
    }
    // Append to existing array
    const newList = existing.trim()
      ? `${existing.trim()}, '${integration}'`
      : `'${integration}'`;
    content = content.replace(
      /integrations\s*:\s*\[[^\]]*\]/,
      `integrations: [${newList}]`
    );
  } else {
    // Add integrations field before the closing of the default export
    content = content.replace(
      /};\s*$/,
      `  integrations: ['${integration}'],\n};\n`
    );
  }

  fs.writeFileSync(configPath, content);
  console.log('  \u2713 Updated lumenjs.config.ts');
}
