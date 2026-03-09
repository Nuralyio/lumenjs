let _projectDir: string | null = null;

export function setProjectDir(dir: string): void {
  _projectDir = dir;
}

export function getProjectDir(): string {
  if (!_projectDir) throw new Error('[LumenJS] Project directory not set');
  return _projectDir;
}
