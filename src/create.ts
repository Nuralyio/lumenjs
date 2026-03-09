import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TEMPLATES = ['default', 'blog', 'dashboard'];

export async function createProject(name: string, template: string): Promise<void> {
  if (!name) {
    console.error('Please provide a project name: lumenjs create <name>');
    process.exit(1);
  }

  if (!TEMPLATES.includes(template)) {
    console.error(`Unknown template "${template}". Available: ${TEMPLATES.join(', ')}`);
    process.exit(1);
  }

  const targetDir = path.resolve(name);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    console.error(`Directory "${name}" already exists and is not empty.`);
    process.exit(1);
  }

  // Templates are at package-root/templates/ (sibling to dist/)
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const templateDir = path.join(__dirname, '..', 'templates', template);

  if (!fs.existsSync(templateDir)) {
    console.error(`Template directory not found: ${templateDir}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  copyDir(templateDir, targetDir, name);

  console.log(`\n  Project created at ./${name}\n`);
  console.log(`  cd ${name}`);
  console.log(`  npm install`);
  console.log(`  npx lumenjs dev\n`);
}

function copyDir(src: string, dest: string, projectName: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath, projectName);
    } else {
      let content = fs.readFileSync(srcPath, 'utf-8');
      content = content.replace(/\{\{PROJECT_NAME\}\}/g, projectName);
      fs.writeFileSync(destPath, content);
    }
  }
}
