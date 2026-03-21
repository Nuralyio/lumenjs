export interface TableColumn {
  name: string;
  type: string;
}

export interface TableDefinition {
  name: string;
  columns: TableColumn[];
}

const _registry = new Map<string, TableDefinition>();

export function defineTable<T extends Record<string, string>>(
  name: string,
  columns: T,
): T {
  const parsed: TableColumn[] = Object.entries(columns).map(([colName, colType]) => ({
    name: colName,
    type: colType,
  }));
  _registry.set(name, { name, columns: parsed });
  return columns;
}

export function getRegisteredTables(): Map<string, TableDefinition> {
  return _registry;
}
