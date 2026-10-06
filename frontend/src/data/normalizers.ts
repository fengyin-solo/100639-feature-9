import type {
  EnvMonitorRow,
  EntryRow,
  FetchState,
  MaterialRow,
  VentilationRow,
  WorkOrderRow,
} from './types'

export const VENTILATION_STATUSES = ['待开机', '运行中', '已停机', '故障停机']
export const ENV_STATUSES = ['待采集', '已采集', '指标正常', '指标超标']
export const WORK_ORDER_STATUSES = ['待处理', '处理中', '已完成']

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
    return Number(value.trim())
  }
  return null
}

function booleanValue(value: unknown): boolean {
  return value === true || text(value) === 'true' || text(value) === '是'
}

export function parseTime(value: unknown): number | null {
  const raw = text(value)
  if (!raw) return null
  const parsed = new Date(raw.replace(' ', 'T')).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDateTime(input: Date | number): string {
  const date = typeof input === 'number' ? new Date(input) : input
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`
}

export function formatDate(input: Date | number): string {
  return formatDateTime(input).slice(0, 10)
}

export function nowTime(): string {
  return formatDateTime(new Date())
}

function chooseStatus(row: EntryRow, statuses: string[], fallback: string): string {
  const current = text(row.status)
  if (statuses.includes(current)) return current
  const stateField = statuses.find((status) => Object.values(row).includes(status))
  return stateField ?? fallback
}

function normalizeVentilation(rows: EntryRow[]): VentilationRow[] {
  return rows.map((row, index): VentilationRow => {
    const status = chooseStatus(row, VENTILATION_STATUSES, '待开机')
    const stopped = status === '已停机' || status === '故障停机'
    const startStop = text(row.启停时间)
    const registered =
      text(row.登记时间) ||
      text(row.投运日期) ||
      (parseTime(startStop) ? startStop : '1970-01-01 00:00（按最早动作推定）')
    const explicitSpeed = finiteNumber(row.送风风速)
    const legacyNonNumeric =
      row.送风风速 !== undefined && row.送风风速 !== null && explicitSpeed === null

    let speed: number | null = explicitSpeed
    let fetchState: FetchState = 'success'
    let failureReason = text(row.取数失败原因) || null
    let lastFetch = text(row.最后取数时间) || null

    if (status === '待开机') {
      speed = null
      fetchState = 'not_collected'
      failureReason = null
      lastFetch = null
    } else if (stopped) {
      speed = 0
      fetchState = 'success'
    } else if (explicitSpeed === null) {
      speed = null
      fetchState = 'failed'
      failureReason ||= legacyNonNumeric
        ? '历史风速字段不是有效数值，需重新取数'
        : '现场风速数据未上报'
      lastFetch ||= text(row.最后取数时间) || null
    }

    let stopReason = text(row.停机原因) || null
    if (!stopReason && status === '故障停机') {
      stopReason = '历史记录未登记，按故障停机推定'
    }
    if (!stopReason && status === '已停机') {
      stopReason = '历史记录未登记，按计划停机推定'
    }

    return {
      ...row,
      id: Number(row.id) || index + 1,
      status,
      pending: status !== '已停机',
      abnormal: status === '故障停机' || fetchState === 'failed',
      机组编号: text(row.机组编号) || `VENT-${String(index + 1).padStart(4, '0')}`,
      所属舱室: text(row.所属舱室) || '未登记舱室',
      风机型号: text(row.风机型号) || '未登记型号',
      运行模式: text(row.运行模式) || '未登记',
      送风风速: speed,
      取数状态: fetchState,
      取数失败原因: failureReason,
      最后取数时间: lastFetch,
      启停时间: startStop || (stopped ? '1970-01-01 00:00（按最早启停动作推定）' : ''),
      操作人员: text(row.操作人员) || '历史值班员',
      停机原因: stopReason,
      风机状态: status,
      故障已上报: booleanValue(row.故障已上报) || status === '故障停机',
      登记时间: registered,
      _sortTime: parseTime(registered) ?? 0,
    }
  })
}

function normalizeEnv(rows: EntryRow[]): EnvMonitorRow[] {
  const ventilationByCabin = new Map<string, VentilationRow>()
  // 环境数据与通风数据分开读取；调用方在 service 中负责补充联动提示。
  return rows.map((row, index): EnvMonitorRow => {
    const metrics = ['环境温度', '空气湿度', '氧气浓度', '有害气体浓度'] as const
    const values = metrics.map((field) => finiteNumber(row[field]))
    const explicitFailed = values.some((value) => value === null)
    let fetchState: FetchState =
      text(row.取数状态) === 'success' || text(row.取数状态) === 'failed' || text(row.取数状态) === 'not_collected'
        ? (text(row.取数状态) as FetchState)
        : explicitFailed
          ? 'failed'
          : 'success'
    let failureReason = text(row.取数失败原因) || null
    if (fetchState === 'failed' && !failureReason) {
      failureReason = '现场环境采集值缺失或不是有效数值'
    }
    if (fetchState !== 'failed') {
      failureReason = null
    }
    const collected = text(row.采集时间)
    const status = chooseStatus(row, ENV_STATUSES, fetchState === 'failed' ? '待采集' : '已采集')
    const registered =
      text(row.登记时间) ||
      text(row.采集时间) ||
      '1970-01-01 00:00（按最早采集动作推定）'

    return {
      ...row,
      id: Number(row.id) || index + 1,
      status: fetchState === 'failed' ? '待采集' : status,
      pending: fetchState === 'failed' || status !== '指标正常',
      abnormal: fetchState === 'failed' || status === '指标超标',
      监测编号: text(row.监测编号) || `ENVM-${String(index + 1).padStart(4, '0')}`,
      监测点位: text(row.监测点位) || '未登记点位',
      环境温度: fetchState === 'failed' ? null : values[0],
      空气湿度: fetchState === 'failed' ? null : values[1],
      氧气浓度: fetchState === 'failed' ? null : values[2],
      有害气体浓度: fetchState === 'failed' ? null : values[3],
      取数状态: fetchState,
      取数失败原因: failureReason,
      最后取数时间: text(row.最后取数时间) || (collected || null),
      采集时间: fetchState === 'failed' ? null : collected || null,
      监测状态: text(row.监测状态) || status,
      登记时间: registered,
      _sortTime: parseTime(registered) ?? 0,
    }
  })
}

function normalizeWorkOrders(rows: EntryRow[]): WorkOrderRow[] {
  return rows.map((row, index): WorkOrderRow => {
    const state = (['待处理', '处理中', '已完成'] as const).find((item) => text(row.派工状态) === item || text(row.status) === item) ?? '待处理'
    return {
      ...row,
      id: Number(row.id) || index + 1,
      status: state,
      pending: state !== '已完成',
      abnormal: state !== '已完成',
      工单编号: text(row.工单编号) || `WO-${String(Date.now())}-${String(index + 1).padStart(3, '0')}`,
      来源模块: text(row.来源模块) || '通风系统运维',
      来源记录: text(row.来源记录) || '未登记',
      所属舱室: text(row.所属舱室) || '未登记舱室',
      异常描述: text(row.异常描述) || '未登记异常',
      处理意见: text(row.处理意见) || '待值班长填写处理意见',
      派工状态: state,
      派工时间: text(row.派工时间) || '1970-01-01 00:00（按最早派工动作推定）',
    }
  })
}

function normalizeMaterialRow(row: EntryRow, index: number): MaterialRow {
  const accepted = text(row.验收日期)
  const registered = text(row.登记时间) || accepted || '1970-01-01 00:00（按最早验收动作推定）'
  const source = text(row.登记来源) === '上报' ? '上报' : '导入'
  return {
    ...row,
    id: Number(row.id) || index + 1,
    status: '已验收',
    pending: false,
    abnormal: false,
    材料编号: text(row.材料编号) || `MAT-${String(index + 1).padStart(4, '0')}`,
    材料名称: text(row.材料名称) || '未命名材料',
    批次号: text(row.批次号) || '未登记批次',
    数量: finiteNumber(row.数量) ?? 0,
    单位: text(row.单位) || '项',
    供货单位: text(row.供货单位) || '未登记单位',
    验收日期: accepted || registered.slice(0, 10),
    登记时间: registered,
    登记来源: source,
    版本: finiteNumber(row.版本) ?? 1,
    材料状态: text(row.材料状态) || '已验收',
    _sortTime: parseTime(registered) ?? 0,
  }
}

export function dedupeMaterials(rows: EntryRow[]): MaterialRow[] {
  const normalized = rows.map(normalizeMaterialRow)
  const chosen = new Map<string, MaterialRow>()
  for (const row of normalized) {
    // 判重口径：上报按「批次号 + 材料编号」判重，重复上报保留最新登记版本；
    // 导入按「材料编号」判重，同一份材料重复导入保留最早登记版本。
    const key = row.登记来源 === '上报'
      ? `report:${row.批次号}|${row.材料编号}`
      : `import:${row.材料编号}`
    const existing = chosen.get(key)
    if (!existing) {
      chosen.set(key, row)
      continue
    }
    const currentTime = parseTime(row.登记时间) ?? 0
    const existingTime = parseTime(existing.登记时间) ?? 0
    const keepNewer = row.登记来源 === '上报'
    const replace = keepNewer ? currentTime >= existingTime : currentTime < existingTime
    chosen.set(key, replace ? { ...row, id: existing.id } : existing)
  }
  return [...chosen.values()].sort(
    (a, b) => (parseTime(b.验收日期) ?? 0) - (parseTime(a.验收日期) ?? 0) || (b._sortTime as number) - (a._sortTime as number),
  )
}

export function normalizeRows(key: string, rows: EntryRow[]): EntryRow[] {
  if (key === 'ventilation') return normalizeVentilation(rows)
  if (key === 'envmonitor') return normalizeEnv(rows)
  if (key === 'workorders') return normalizeWorkOrders(rows)
  if (key === 'materials') return dedupeMaterials(rows)
  return rows
}
