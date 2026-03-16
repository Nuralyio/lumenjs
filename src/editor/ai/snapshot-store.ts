/**
 * In-memory file snapshot store for AI turn rollback.
 * Saves file contents before each AI turn so they can be restored.
 */

export interface Snapshot {
  turnId: string;
  files: Map<string, string>;
  timestamp: number;
}

const MAX_SNAPSHOTS = 10;
const snapshots: Snapshot[] = [];

/**
 * Save a snapshot of file contents before an AI turn.
 */
export function save(turnId: string, files: Map<string, string>): void {
  snapshots.push({ turnId, files, timestamp: Date.now() });
  // Keep only the last N snapshots
  while (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift();
  }
}

/**
 * Restore file contents from a saved snapshot.
 * Returns the files map if found, null otherwise.
 */
export function restore(turnId: string): Map<string, string> | null {
  const idx = snapshots.findIndex(s => s.turnId === turnId);
  if (idx === -1) return null;

  const snapshot = snapshots[idx];
  // Remove this and all newer snapshots (they're invalidated by rollback)
  snapshots.splice(idx);
  return snapshot.files;
}

/**
 * List available snapshot turn IDs (newest first).
 */
export function listTurns(): string[] {
  return snapshots.map(s => s.turnId).reverse();
}
