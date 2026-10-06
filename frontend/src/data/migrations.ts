import type { ActionLog, EntryRow } from './types'

// 存量数据迁移：每次读库后幂等地跑一遍，把早年登记的记录补成新结构。
//
// 回填口径（通风机组）：
// - 送风风速：占位字符串能转成数字的按数字留，转不了的置 null（空态），并写明取数失败原因；
//   null 表示没取到数，与测量值 0 严格区分。
// - 停机原因：已停机 / 故障停机但早年没登记原因的，按下面规则补录——
//     故障停机 → 「历史故障停机，原因未登记，按启停时间补录」
//     已停机   → 「计划性停机（历史数据补录）」
// - 启停时间：缺失的按该机组操作记录里最早一次动作的时间推定。

function asLogArray(value: unknown): ActionLog[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (item): item is ActionLog =>
      typeof item === 'object' && item !== null && '时间' in item && '动作' in item,
  )
}

function earliestLogTime(logs: ActionLog[]): string {
  return logs.map((log) => log.时间).sort()[0] ?? ''
}

function migrateVentilationRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  const logs = asLogArray(next.操作记录)
  next.操作记录 = logs

  // 送风风速归一化：数字保持原样（含 0）；数字字符串转数字；其余一律置空态。
  const raw = next.送风风速
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    next.送风风速 = raw.trim() !== '' && Number.isFinite(parsed) ? parsed : null
  } else if (typeof raw !== 'number') {
    next.送风风速 = null
  }

  if (typeof next.取数失败原因 !== 'string') {
    next.取数失败原因 = ''
  }
  if (next.送风风速 === null && next.取数失败原因 === '') {
    if (next.status === '故障停机') {
      next.取数失败原因 = '机组故障停机，采集通道中断'
    } else if (next.status === '已停机') {
      next.取数失败原因 = '机组已停机，现场无送风数据'
    } else if (next.status === '待开机') {
      next.取数失败原因 = '机组未开机，无送风数据'
    } else {
      next.取数失败原因 = '历史数据未采集到风速，待重新取数'
    }
  }

  if (typeof next.停机原因 !== 'string') {
    next.停机原因 = ''
  }
  if (next.停机原因 === '') {
    if (next.status === '故障停机') {
      next.停机原因 = '历史故障停机，原因未登记，按启停时间补录'
    } else if (next.status === '已停机') {
      next.停机原因 = '计划性停机（历史数据补录）'
    }
  }

  if (typeof next.处理意见 !== 'string') {
    next.处理意见 = ''
  }
  if (typeof next.模拟取数失败次数 !== 'number') {
    next.模拟取数失败次数 = 0
  }

  if (typeof next.启停时间 !== 'string') {
    next.启停时间 = ''
  }
  if (next.启停时间 === '' && logs.length > 0) {
    next.启停时间 = earliestLogTime(logs)
  }
  return next
}

function migrateEnvmonitorRow(row: EntryRow): EntryRow {
  const next: EntryRow = { ...row }
  if (typeof next.采集失败原因 !== 'string') {
    next.采集失败原因 = ''
  }
  return next
}

export function migrateRows(key: string, rows: EntryRow[]): EntryRow[] {
  if (key === 'ventilation') {
    return rows.map(migrateVentilationRow)
  }
  if (key === 'envmonitor') {
    return rows.map(migrateEnvmonitorRow)
  }
  return rows
}
