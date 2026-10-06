import { domainSeedRows, DOMAIN_SEED_ROWS } from './domain-seed'
import { normalizeRows } from './normalizers'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'urban-utility-tunnel:entries'
const STORAGE_VERSION = 2

type StoredData = {
  __version: number
  rows: Record<string, EntryRow[]>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function buildSeed(): Record<string, EntryRow[]> {
  return {
    ...clone(SEED_ROWS),
    ...clone(DOMAIN_SEED_ROWS),
  }
}

function normalizeAll(rows: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  return Object.fromEntries(
    Object.entries(rows).map(([key, items]) => [key, normalizeRows(key, items)]),
  )
}

function writeStorage(rows: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const payload: StoredData = { __version: STORAGE_VERSION, rows }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = normalizeAll(buildSeed())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    writeStorage(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as StoredData | Record<string, EntryRow[]>
    const isStoredData = (value: StoredData | Record<string, EntryRow[]>): value is StoredData =>
      '__version' in value
    // v1 里通风和环境字段把缺失误写成 0/占位串，升级到 v2 时用新种子替换这两个域表，其余模块沿用用户数据。
    const domainOverrides: Record<string, EntryRow[]> = isStoredData(parsed) && parsed.__version < 2
      ? {
          ventilation: fallback.ventilation,
          envmonitor: fallback.envmonitor,
          workorders: fallback.workorders,
          materials: fallback.materials,
        }
      : {}
    const storedRows: Record<string, EntryRow[]> = isStoredData(parsed)
      ? { ...parsed.rows, ...domainOverrides }
      : parsed as Record<string, EntryRow[]>
    const merged = isStoredData(parsed)
      ? { ...fallback, ...storedRows }
      : { ...fallback, ...storedRows, ventilation: fallback.ventilation, envmonitor: fallback.envmonitor, workorders: fallback.workorders, materials: fallback.materials }
    const normalized = normalizeAll(merged)
    writeStorage(normalized)
    return normalized
  } catch {
    writeStorage(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: normalizeRows(key, rows) }
  cache = next
  writeStorage(next)
}

export function resetRows(key: string): EntryRow[] {
  const seed: EntryRow[] = domainSeedRows(key).length ? domainSeedRows(key) : SEED_ROWS[key] ?? []
  const rows = clone<EntryRow[]>(seed)
  saveRows(key, rows)
  return listRows(key)
}

export function storageKey(): string {
  return STORAGE_KEY
}
