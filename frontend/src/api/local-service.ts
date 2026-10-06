import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listImportBatches,
  listDispatchItems,
  listRows,
  resetRows,
  saveImportBatches,
  saveDispatchItems,
  saveRows,
} from '@/data/local-store'
import type {
  ActionLog,
  ActionResult,
  DispatchItem,
  EntryRow,
  ImportBatch,
  ImportResult,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

/* ------------------------------------------------------------------ */
/* 通风系统运维：现场取数、停机原因、故障幂等、派工回写、材料导入判重        */
/* ------------------------------------------------------------------ */

const VENT_KEY = 'ventilation'

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function nowText(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

function todayText(): string {
  return nowText().slice(0, 10)
}

function appendLog(row: EntryRow, 动作: string): ActionLog[] {
  const logs = Array.isArray(row.操作记录) ? (row.操作记录 as ActionLog[]) : []
  return [...logs, { 时间: nowText(), 动作 }]
}

function findVentilation(id: number): { rows: EntryRow[]; index: number } | null {
  const rows = listRows(VENT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  return index < 0 ? null : { rows, index }
}

function saveVentilationRow(rows: EntryRow[], index: number, updated: EntryRow): void {
  const next = [...rows]
  next[index] = updated
  saveRows(VENT_KEY, next)
}

/**
 * 模拟现场取数：送风风速来自现场采集，取不到就是空态（null），绝不回退成 0。
 * - 待开机 / 已停机 / 故障停机：取不到数，写明对应原因；
 * - 运行中但「模拟取数失败次数」> 0：本次按网关超时失败处理，重试可再取；
 * - 其余情况取数成功，写入风速值。
 */
export function fetchAirSpeed(id: number): ActionResult {
  const found = findVentilation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的通风机组` }
  }
  const { rows, index } = found
  const row = rows[index]

  const fail = (reason: string): ActionResult => {
    // 重新读一次，避免覆盖掉同一次取数里刚写入的模拟失败次数扣减。
    const fresh = findVentilation(id)
    if (!fresh) {
      return { ok: false, message: `没有找到编号为 ${id} 的通风机组` }
    }
    const current = fresh.rows[fresh.index]
    saveVentilationRow(fresh.rows, fresh.index, {
      ...current,
      送风风速: null,
      取数失败原因: reason,
      操作记录: appendLog(current, `现场取数失败：${reason}`),
    })
    return { ok: false, message: `取数失败：${reason}` }
  }

  if (row.status === '故障停机') {
    return fail('机组故障停机，采集通道中断')
  }
  if (row.status === '已停机') {
    return fail('机组已停机，现场无送风数据')
  }
  if (row.status === '待开机') {
    return fail('机组未开机，无送风数据')
  }
  const failuresLeft = Number(row.模拟取数失败次数 ?? 0)
  if (failuresLeft > 0) {
    saveVentilationRow(rows, index, { ...row, 模拟取数失败次数: failuresLeft - 1 })
    return fail('现场采集网关超时，请重新取数')
  }
  const speed = Number((2.4 + (Number(row.id) % 6) * 0.3).toFixed(1))
  saveVentilationRow(rows, index, {
    ...row,
    送风风速: speed,
    取数失败原因: '',
    操作记录: appendLog(row, `现场取数成功，送风风速 ${speed} m/s`),
  })
  return { ok: true, message: `已重新取数，送风风速 ${speed} m/s` }
}

/** 提交开机：机组转运行中，记录启停时间，办结关联派工单，并自动取一次数。 */
export function startVentilation(id: number): ActionResult {
  const found = findVentilation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的通风机组` }
  }
  const { rows, index } = found
  const row = rows[index]
  if (row.status === '运行中') {
    return { ok: false, message: '机组已在运行中，不用重复开机' }
  }
  saveVentilationRow(rows, index, {
    ...row,
    status: '运行中',
    pending: false,
    abnormal: false,
    启停时间: nowText(),
    操作记录: appendLog(row, '提交开机'),
  })
  closeDispatchFor(String(row.机组编号))
  const fetchResult = fetchAirSpeed(id)
  return { ok: true, message: `机组已开机，当前状态「运行中」。${fetchResult.message}` }
}

/** 登记停机：必须填停机原因，停机的机组风速置空态并写明原因。 */
export function stopVentilation(id: number, reason: string): ActionResult {
  const found = findVentilation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的通风机组` }
  }
  const trimmed = reason.trim()
  if (!trimmed) {
    return { ok: false, message: '登记停机必须填写停机原因' }
  }
  const { rows, index } = found
  const row = rows[index]
  if (row.status === '已停机') {
    return { ok: false, message: '机组已是已停机，不用重复登记' }
  }
  saveVentilationRow(rows, index, {
    ...row,
    status: '已停机',
    pending: false,
    abnormal: false,
    停机原因: trimmed,
    启停时间: nowText(),
    送风风速: null,
    取数失败原因: '机组已停机，现场无送风数据',
    操作记录: appendLog(row, `登记停机：${trimmed}`),
  })
  return { ok: true, message: `机组已登记停机，停机原因：${trimmed}` }
}

/**
 * 上报故障：同一机组重复上报只记一次。
 * 已是故障停机的机组再次上报直接返回已登记，不重复置状态、不重复生成派工单。
 */
export function reportVentilationFault(id: number, reason: string): ActionResult {
  const found = findVentilation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的通风机组` }
  }
  const trimmed = reason.trim()
  if (!trimmed) {
    return { ok: false, message: '上报故障必须填写故障原因' }
  }
  const { rows, index } = found
  const row = rows[index]
  if (row.status === '故障停机') {
    return {
      ok: true,
      message: `该机组故障已登记（停机原因：${row.停机原因}），本次重复上报不再记录`,
    }
  }
  saveVentilationRow(rows, index, {
    ...row,
    status: '故障停机',
    pending: true,
    abnormal: true,
    停机原因: trimmed,
    启停时间: nowText(),
    送风风速: null,
    取数失败原因: '机组故障停机，采集通道中断',
    操作记录: appendLog(row, `上报故障：${trimmed}`),
  })
  const dispatch = ensureDispatchFor(row, trimmed)
  return { ok: true, message: `故障已登记，机组转「故障停机」，已生成派工单 ${dispatch.工单编号}` }
}

/** 登记处理意见：写到机组上，同时回写派工清单同一条工单，两边取到同一份。 */
export function saveHandlingOpinion(id: number, opinion: string): ActionResult {
  const found = findVentilation(id)
  if (!found) {
    return { ok: false, message: `没有找到编号为 ${id} 的通风机组` }
  }
  const trimmed = opinion.trim()
  if (!trimmed) {
    return { ok: false, message: '处理意见不能为空' }
  }
  const { rows, index } = found
  const row = rows[index]
  const items = listDispatchItems()
  const dispatchIndex = items.findIndex(
    (item) => item.机组编号 === row.机组编号 && item.status === '待处理',
  )
  if (dispatchIndex < 0) {
    return { ok: false, message: '该机组没有待处理的派工单，处理意见无处回写' }
  }
  saveVentilationRow(rows, index, {
    ...row,
    处理意见: trimmed,
    操作记录: appendLog(row, `登记处理意见：${trimmed}`),
  })
  const nextItems = [...items]
  nextItems[dispatchIndex] = { ...items[dispatchIndex], 处理意见: trimmed }
  saveDispatchItems(nextItems)
  return {
    ok: true,
    message: `处理意见已回写派工单 ${items[dispatchIndex].工单编号}，通风页与检修页取同一份`,
  }
}

/** 登记通风机组：机组编号照常登记，判重口径为机组编号，重复编号不重复登记。 */
export function createVentilationUnit(input: {
  机组编号: string
  所属舱室: string
  风机型号: string
  运行模式: string
  操作人员: string
}): ActionResult {
  const unitNo = input.机组编号.trim()
  const cabin = input.所属舱室.trim()
  if (!unitNo || !cabin) {
    return { ok: false, message: '机组编号与所属舱室必须填写' }
  }
  const rows = listRows(VENT_KEY)
  if (rows.some((row) => row.机组编号 === unitNo)) {
    return { ok: false, message: `机组编号 ${unitNo} 已登记（判重口径：机组编号），不重复登记` }
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = {
    id,
    status: '待开机',
    pending: true,
    abnormal: false,
    机组编号: unitNo,
    所属舱室: cabin,
    风机型号: input.风机型号.trim(),
    运行模式: input.运行模式.trim(),
    送风风速: null,
    取数失败原因: '机组未开机，无送风数据',
    启停时间: '',
    停机原因: '',
    处理意见: '',
    操作人员: input.操作人员.trim(),
    模拟取数失败次数: 0,
    操作记录: [{ 时间: nowText(), 动作: '登记机组' }],
  }
  saveRows(VENT_KEY, [...rows, created])
  return { ok: true, message: `机组 ${unitNo} 已登记，当前状态「待开机」` }
}

function ensureDispatchFor(row: EntryRow, reason: string): DispatchItem {
  const items = listDispatchItems()
  const open = items.find((item) => item.机组编号 === row.机组编号 && item.status === '待处理')
  if (open) {
    return open
  }
  const id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1
  const created: DispatchItem = {
    id,
    工单编号: `DISP-${String(id).padStart(4, '0')}`,
    机组编号: String(row.机组编号),
    所属舱室: String(row.所属舱室),
    故障原因: reason,
    处理意见: '',
    登记时间: nowText(),
    验收日期: null,
    status: '待处理',
  }
  saveDispatchItems([...items, created])
  return created
}

function closeDispatchFor(unitNo: string): void {
  const items = listDispatchItems()
  const index = items.findIndex((item) => item.机组编号 === unitNo && item.status === '待处理')
  if (index < 0) {
    return
  }
  const next = [...items]
  next[index] = { ...items[index], status: '已办结', 验收日期: todayText() }
  saveDispatchItems(next)
}

/** 派工清单：既有条目按验收日期归位，未验收的按登记时间推定排序。通风页与检修页都读这一份。 */
export function listDispatch(): DispatchItem[] {
  return [...listDispatchItems()].sort((a, b) =>
    (a.验收日期 ?? a.登记时间).localeCompare(b.验收日期 ?? b.登记时间),
  )
}

/** 已导入批次：同样按验收日期归位，早年没有验收日期的按登记时间推定。 */
export function listBatches(): ImportBatch[] {
  return [...listImportBatches()].sort((a, b) =>
    (a.验收日期 || a.登记时间).localeCompare(b.验收日期 || b.登记时间),
  )
}

/**
 * 导入运行材料（JSON 文本）。判重口径：
 * - 批次按「批次号」判重：同一批次号重复导入只留最早那一版，不会多出一行；
 * - 批内行按「机组编号」判重：新批次再报同一机组，整行业务字段以最新那版为准覆盖，
 *   不把两版并在一起；新机组编号则新增登记。
 */
export function importVentilationBatch(raw: string): ImportResult {
  const fail = (message: string): ImportResult => ({
    ok: false,
    message,
    added: 0,
    updated: 0,
    duplicated: false,
  })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return fail('材料不是有效的 JSON，请按示例格式整理后再导入')
  }
  if (typeof payload !== 'object' || payload === null) {
    return fail('材料结构不对：需要包含批次号与 rows 数组')
  }
  const batch = payload as { 批次号?: unknown; 验收日期?: unknown; rows?: unknown }
  const 批次号 = typeof batch.批次号 === 'string' ? batch.批次号.trim() : ''
  if (!批次号) {
    return fail('材料缺少批次号，无法判重')
  }
  if (!Array.isArray(batch.rows) || batch.rows.length === 0) {
    return fail('材料里没有可导入的行（rows 为空）')
  }

  const batches = listImportBatches()
  if (batches.some((item) => item.批次号 === 批次号)) {
    return {
      ok: true,
      message: `批次 ${批次号} 此前已导入，重复导入只保留最早那一版，本次未新增或修改任何记录`,
      added: 0,
      updated: 0,
      duplicated: true,
    }
  }

  const rows = [...listRows(VENT_KEY)]
  let added = 0
  let updated = 0
  for (const [position, item] of batch.rows.entries()) {
    if (typeof item !== 'object' || item === null) {
      return fail(`第 ${position + 1} 行不是对象，整批未导入`)
    }
    const line = item as Record<string, unknown>
    const unitNo = typeof line.机组编号 === 'string' ? line.机组编号.trim() : ''
    if (!unitNo) {
      return fail(`第 ${position + 1} 行缺少机组编号，整批未导入`)
    }
    const speed =
      typeof line.送风风速 === 'number' && Number.isFinite(line.送风风速) ? line.送风风速 : null
    const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

    const index = rows.findIndex((row) => row.机组编号 === unitNo)
    if (index >= 0) {
      // 同一机组再报一遍：只留最新那版，业务字段整行覆盖，不做两版合并。
      const row = rows[index]
      rows[index] = {
        ...row,
        所属舱室: text(line.所属舱室),
        风机型号: text(line.风机型号),
        运行模式: text(line.运行模式),
        操作人员: text(line.操作人员),
        送风风速: speed,
        取数失败原因: speed === null ? '该批次未上报风速，待重新取数' : '',
        操作记录: appendLog(row, `批次 ${批次号} 覆盖导入（只留最新版）`),
      }
      updated += 1
    } else {
      const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
      rows.push({
        id,
        status: '待开机',
        pending: true,
        abnormal: false,
        机组编号: unitNo,
        所属舱室: text(line.所属舱室),
        风机型号: text(line.风机型号),
        运行模式: text(line.运行模式),
        操作人员: text(line.操作人员),
        送风风速: speed,
        取数失败原因: speed === null ? '该批次未上报风速，待重新取数' : '',
        启停时间: '',
        停机原因: '',
        处理意见: '',
        模拟取数失败次数: 0,
        操作记录: [{ 时间: nowText(), 动作: `批次 ${批次号} 导入登记` }],
      })
      added += 1
    }
  }

  saveRows(VENT_KEY, rows)
  saveImportBatches([
    ...batches,
    {
      批次号,
      验收日期: typeof batch.验收日期 === 'string' && batch.验收日期.trim() ? batch.验收日期.trim() : todayText(),
      登记时间: nowText(),
      行数: batch.rows.length,
      新增: added,
      更新: updated,
    },
  ])
  return {
    ok: true,
    message: `批次 ${批次号} 导入完成：新增 ${added} 台，覆盖更新 ${updated} 台（判重口径：批次号 + 机组编号）`,
    added,
    updated,
    duplicated: false,
  }
}

/** 停下来的机组（已停机 / 故障停机）按舱室汇总，给环境监测页做联动提示。 */
export function stoppedVentilationByCabin(): { 舱室: string; 提示: string }[] {
  return listRows(VENT_KEY)
    .filter((row) => row.status === '已停机' || row.status === '故障停机')
    .map((row) => ({
      舱室: String(row.所属舱室),
      提示: `${row.机组编号} ${row.status}${row.停机原因 ? `（${row.停机原因}）` : ''}`,
    }))
}

/** 监测点位命中已停通风的舱室时，给出「本舱室通风已停」的同步说明。 */
export function cabinVentilationNotice(point: string): string {
  const target = point.trim()
  if (!target) {
    return ''
  }
  const hit = stoppedVentilationByCabin().find(
    (item) => target.includes(item.舱室) || item.舱室.includes(target),
  )
  return hit ? `本舱室通风已停：${hit.提示}` : ''
}
