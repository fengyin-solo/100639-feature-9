import { migrateRows } from './migrations'
import { SEED_BATCHES, SEED_DISPATCH, SEED_ROWS } from './seed'
import type { DispatchItem, EntryRow, ImportBatch } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 版本 2 起存储结构为 { version, entries, dispatch, batches }；
// 早期版本直接存条目映射，读取时自动升级并回填存量数据。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
const STORAGE_VERSION = 2

type StorageShape = {
  version: number
  entries: Record<string, EntryRow[]>
  dispatch: DispatchItem[]
  batches: ImportBatch[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedShape(): StorageShape {
  return {
    version: STORAGE_VERSION,
    entries: clone(SEED_ROWS),
    dispatch: clone(SEED_DISPATCH),
    batches: clone(SEED_BATCHES),
  }
}

function migrateShape(shape: StorageShape): StorageShape {
  const entries: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(shape.entries)) {
    entries[key] = migrateRows(key, rows)
  }
  return { ...shape, version: STORAGE_VERSION, entries }
}

function parseShape(raw: string | null): StorageShape {
  const fallback = seedShape()
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StorageShape> & Record<string, unknown>
    // 新结构：带 version 与 entries 字段。
    if (typeof parsed.version === 'number' && parsed.entries && typeof parsed.entries === 'object') {
      return {
        version: parsed.version,
        entries: { ...fallback.entries, ...(parsed.entries as Record<string, EntryRow[]>) },
        dispatch: Array.isArray(parsed.dispatch) ? parsed.dispatch : clone(SEED_DISPATCH),
        batches: Array.isArray(parsed.batches) ? parsed.batches : clone(SEED_BATCHES),
      }
    }
    // 旧结构：整个对象就是条目映射，派工清单与批次用种子补上。
    return {
      ...fallback,
      entries: { ...fallback.entries, ...(parsed as unknown as Record<string, EntryRow[]>) },
    }
  } catch {
    return fallback
  }
}

function readStorage(): StorageShape {
  const fallback = seedShape()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const shape = migrateShape(parseShape(window.localStorage.getItem(STORAGE_KEY)))
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  return shape
}

let cache: StorageShape | null = null

function store(): StorageShape {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store()))
  }
}

export function allRows(): Record<string, EntryRow[]> {
  return store().entries
}

export function listRows(key: string): EntryRow[] {
  return store().entries[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  store().entries = { ...store().entries, [key]: rows }
  persist()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function listDispatchItems(): DispatchItem[] {
  return store().dispatch
}

export function saveDispatchItems(items: DispatchItem[]): void {
  store().dispatch = items
  persist()
}

export function listImportBatches(): ImportBatch[] {
  return store().batches
}

export function saveImportBatches(batches: ImportBatch[]): void {
  store().batches = batches
  persist()
}

export function storageKey(): string {
  return STORAGE_KEY
}
