import { filterRows } from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import { formatDateTime, formatDate, nowTime } from '@/data/normalizers'
import type {
  ActionResult,
  EnvMonitorRow,
  EntryRow,
  MaterialRow,
  VentilationRow,
  WorkOrderRow,
} from '@/data/types'

const PERSISTENT_FAILURES = ['网关', '信号线路', '终端离线', '心跳丢失']

function rowsAs<T extends EntryRow>(key: string): T[] {
  return listRows(key) as T[]
}

function isPersistentFailure(reason: string): boolean {
  return PERSISTENT_FAILURES.some((keyword) => reason.includes(keyword))
}

function nextId(key: string): number {
  const rows = listRows(key)
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function listModule<T extends EntryRow>(key: string, filters: Record<string, string>): T[] {
  return filterRows(listRows(key), filters) as T[]
}

export function listVentilation(filters: Record<string, string> = {}): VentilationRow[] {
  return listModule<VentilationRow>('ventilation', filters)
}

export function listEnvMonitors(filters: Record<string, string> = {}): EnvMonitorRow[] {
  return listModule<EnvMonitorRow>('envmonitor', filters)
}

export function listWorkOrders(filters: Record<string, string> = {}): WorkOrderRow[] {
  return listModule<WorkOrderRow>('workorders', filters)
}

export function listMaterials(filters: Record<string, string> = {}): MaterialRow[] {
  return listModule<MaterialRow>('materials', filters)
}

function saveVentilation(rows: VentilationRow[]): void {
  saveRows('ventilation', rows)
}

function saveWorkOrders(rows: WorkOrderRow[]): void {
  saveRows('workorders', rows)
}

function saveMaterials(rows: MaterialRow[]): void {
  saveRows('materials', rows)
}

function upsertFaultWorkOrder(row: VentilationRow): WorkOrderRow[] {
  const orders = rowsAs<WorkOrderRow>('workorders')
  const description = `${row.停机原因 ?? '设备故障'}，机组故障停机`
  const existingIndex = orders.findIndex(
    (item) =>
      item.来源记录 === row.机组编号 &&
      item.来源模块 === '通风系统运维' &&
      item.派工状态 !== '已完成',
  )

  if (existingIndex >= 0) {
    orders[existingIndex] = {
      ...orders[existingIndex],
      所属舱室: row.所属舱室,
      异常描述: description,
    }
    saveWorkOrders(orders)
    return orders
  }

  const time = nowTime()
  const order: WorkOrderRow = {
    id: nextId('workorders'),
    status: '待处理',
    pending: true,
    abnormal: true,
    工单编号: `WO-${time.replace(/[-: ]/g, '').slice(0, 8)}-${String(orders.length + 1).padStart(4, '0')}`,
    来源模块: '通风系统运维',
    来源记录: row.机组编号,
    所属舱室: row.所属舱室,
    异常描述: description,
    处理意见: '请检修班现场核查故障原因，处置完成后回填检修结果。',
    派工状态: '待处理',
    派工时间: time,
  }
  const next = [order, ...orders]
  saveWorkOrders(next)
  return next
}

function measuredSpeed(): number {
  return Number((3.2 + Math.random() * 1.2).toFixed(1))
}

export function createVentilation(input: {
  机组编号: string
  所属舱室: string
  风机型号: string
  运行模式: string
  操作人员: string
}): ActionResult {
  const code = input.机组编号.trim()
  const cabin = input.所属舱室.trim()
  if (!code || !cabin) return { ok: false, message: '机组编号和所属舱室必须登记' }
  const rows = rowsAs<VentilationRow>('ventilation')
  if (rows.some((row) => row.机组编号 === code)) {
    return { ok: false, message: `机组编号 ${code} 已登记，不能重复建档` }
  }
  const time = nowTime()
  const row: VentilationRow = {
    id: nextId('ventilation'),
    status: '待开机',
    pending: true,
    abnormal: false,
    机组编号: code,
    所属舱室: cabin,
    风机型号: input.风机型号.trim() || '未登记型号',
    运行模式: input.运行模式.trim() || '未登记模式',
    送风风速: null,
    取数状态: 'not_collected',
    取数失败原因: null,
    最后取数时间: null,
    启停时间: time,
    操作人员: input.操作人员.trim() || '值班员',
    停机原因: null,
    风机状态: '待开机',
    故障已上报: false,
    登记时间: time,
  }
  saveVentilation([...rows, row])
  return { ok: true, message: `机组 ${code} 已登记，当前待开机` }
}

export function startVentilation(id: number): ActionResult {
  const rows = rowsAs<VentilationRow>('ventilation')
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到该通风机组' }
  const row = rows[index]
  if (row.status === '运行中') return { ok: false, message: `${row.机组编号} 已在运行中` }
  const time = nowTime()
  rows[index] = {
    ...row,
    status: '运行中',
    pending: true,
    abnormal: false,
    送风风速: measuredSpeed(),
    取数状态: 'success',
    取数失败原因: null,
    最后取数时间: time,
    启停时间: time,
    停机原因: null,
    风机状态: '运行中',
    故障已上报: false,
  }
  saveVentilation(rows)
  return { ok: true, message: `${row.机组编号} 已提交开机` }
}

export function stopVentilation(id: number, reason: string): ActionResult {
  const rows = rowsAs<VentilationRow>('ventilation')
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到该通风机组' }
  const row = rows[index]
  if (row.status === '已停机') return { ok: false, message: `${row.机组编号} 已经是计划停机，未重复登记` }
  const stopReason = reason.trim() || '按计划停机'
  const time = nowTime()
  rows[index] = {
    ...row,
    status: '已停机',
    pending: false,
    abnormal: false,
    送风风速: 0,
    取数状态: 'success',
    取数失败原因: null,
    启停时间: time,
    停机原因: stopReason,
    风机状态: '已停机',
    故障已上报: false,
  }
  saveVentilation(rows)
  return { ok: true, message: `${row.机组编号} 已登记停机：${stopReason}` }
}

export function reportVentilationFault(id: number, reason: string): ActionResult {
  const rows = rowsAs<VentilationRow>('ventilation')
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到该通风机组' }
  const row = rows[index]
  if (row.status === '故障停机') {
    return { ok: false, message: `${row.机组编号} 的故障已记录，重复上报只保留一次，未再次置为故障停机` }
  }
  const faultReason = reason.trim()
  if (!faultReason) return { ok: false, message: '故障停机原因必须填写' }
  const time = nowTime()
  const updated: VentilationRow = {
    ...row,
    status: '故障停机',
    pending: false,
    abnormal: true,
    送风风速: 0,
    取数状态: 'success',
    取数失败原因: null,
    启停时间: time,
    停机原因: faultReason,
    风机状态: '故障停机',
    故障已上报: true,
  }
  rows[index] = updated
  saveVentilation(rows)
  upsertFaultWorkOrder(updated)
  return { ok: true, message: `${row.机组编号} 已置为故障停机，并写入同一份派工清单` }
}

export function retryVentilationFetch(id: number): ActionResult {
  const rows = rowsAs<VentilationRow>('ventilation')
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到该通风机组' }
  const row = rows[index]
  if (row.取数状态 !== 'failed') return { ok: false, message: '该机组当前没有取数失败，无需重试' }
  const reason = row.取数失败原因 ?? ''
  if (isPersistentFailure(reason)) {
    rows[index] = { ...row, 最后取数时间: nowTime() }
    saveVentilation(rows)
    return { ok: false, message: `重新取数失败：${reason}` }
  }
  rows[index] = {
    ...row,
    送风风速: measuredSpeed(),
    取数状态: 'success',
    取数失败原因: null,
    最后取数时间: nowTime(),
    abnormal: false,
  }
  saveVentilation(rows)
  return { ok: true, message: '重新取数成功，已显示实测风速' }
}

export type EnvCabinStatus = {
  cabin: string
  ventilationText: string
  stopped: boolean
}

export function cabinVentilationStatus(cabin: string): EnvCabinStatus {
  const units = rowsAs<VentilationRow>('ventilation').filter((row) => row.所属舱室 === cabin)
  if (!units.length) return { cabin, ventilationText: '未登记通风机组', stopped: false }
  const running = units.filter((row) => row.status === '运行中')
  if (running.length) {
    return { cabin, ventilationText: `通风运行中（${running.length}/${units.length}）`, stopped: false }
  }
  const fault = units.some((row) => row.status === '故障停机')
  return {
    cabin,
    ventilationText: fault ? `通风故障已停（${units.map((item) => item.停机原因 ?? item.机组编号).join('；')}）` : '通风已停',
    stopped: true,
  }
}

export function envRowsWithVentilation(filters: Record<string, string> = {}): Array<EnvMonitorRow & EnvCabinStatus> {
  return listEnvMonitors(filters).map((row) => ({
    ...row,
    ...cabinVentilationStatus(row.监测点位),
  }))
}

export function retryEnvFetch(id: number): ActionResult {
  const rows = rowsAs<EnvMonitorRow>('envmonitor')
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到该环境监测点' }
  const row = rows[index]
  if (row.取数状态 !== 'failed') return { ok: false, message: '该监测点当前没有取数失败，无需重试' }
  const reason = row.取数失败原因 ?? ''
  if (isPersistentFailure(reason)) {
    rows[index] = { ...row, 最后取数时间: nowTime() }
    saveRows('envmonitor', rows)
    return { ok: false, message: `重新取数失败：${reason}` }
  }
  const time = nowTime()
  rows[index] = {
    ...row,
    status: '指标正常',
    pending: false,
    abnormal: false,
    环境温度: Number((22 + Math.random() * 4).toFixed(1)),
    空气湿度: Math.round(55 + Math.random() * 15),
    氧气浓度: Number((20.5 + Math.random() * 0.8).toFixed(1)),
    有害气体浓度: 0,
    取数状态: 'success',
    取数失败原因: null,
    最后取数时间: time,
    采集时间: time,
    监测状态: '指标正常',
  }
  saveRows('envmonitor', rows)
  return { ok: true, message: '环境数据重新取数成功' }
}

export function updateWorkOrder(id: number, patch: { 处理意见: string; 派工状态: WorkOrderRow['派工状态'] }): ActionResult {
  const opinion = patch.处理意见.trim()
  if (!opinion) return { ok: false, message: '处理意见不能为空' }
  const rows = rowsAs<WorkOrderRow>('workorders')
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return { ok: false, message: '没有找到该派工单' }
  rows[index] = {
    ...rows[index],
    处理意见: opinion,
    派工状态: patch.派工状态,
    status: patch.派工状态,
    pending: patch.派工状态 !== '已完成',
    abnormal: patch.派工状态 !== '已完成',
  }
  saveWorkOrders(rows)
  return { ok: true, message: '派工清单已更新，其他入口读取同一份数据' }
}

export type MaterialSummary = {
  date: string
  unit: string
  batches: number
  quantity: number
  items: MaterialRow[]
}

export function materialSummary(): MaterialSummary[] {
  const map = new Map<string, MaterialSummary>()
  for (const row of listMaterials()) {
    const key = `${row.验收日期}|${row.单位}`
    const item = map.get(key) ?? { date: row.验收日期, unit: row.单位, batches: 0, quantity: 0, items: [] }
    item.batches += 1
    item.quantity += row.数量
    item.items.push(row)
    map.set(key, item)
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.unit.localeCompare(b.unit))
}

export function upsertReportedMaterial(input: {
  材料编号: string
  材料名称: string
  批次号: string
  数量: number
  单位: string
  供货单位: string
  验收日期: string
}): ActionResult {
  if (!input.材料编号.trim() || !input.批次号.trim() || !input.材料名称.trim()) {
    return { ok: false, message: '材料编号、材料名称和批次号必须填写' }
  }
  if (!Number.isFinite(Number(input.数量)) || Number(input.数量) < 0) {
    return { ok: false, message: '数量必须是不小于 0 的数字' }
  }
  const rows = rowsAs<MaterialRow>('materials')
  const key = `${input.批次号.trim()}|${input.材料编号.trim()}`
  const index = rows.findIndex(
    (row) => row.登记来源 === '上报' && `${row.批次号}|${row.材料编号}` === key,
  )
  const time = nowTime()
  if (index >= 0) {
    rows[index] = {
      ...rows[index],
      材料名称: input.材料名称.trim(),
      数量: Number(input.数量),
      单位: input.单位.trim() || rows[index].单位,
      供货单位: input.供货单位.trim() || rows[index].供货单位,
      验收日期: input.验收日期 || rows[index].验收日期,
      登记时间: time,
      版本: rows[index].版本 + 1,
    }
    saveMaterials(rows)
    return { ok: true, message: '同批次材料重复上报，已用最新版本覆盖，未合并出第二行' }
  }
  const row: MaterialRow = {
    id: nextId('materials'),
    status: '已验收',
    pending: false,
    abnormal: false,
    材料编号: input.材料编号.trim(),
    材料名称: input.材料名称.trim(),
    批次号: input.批次号.trim(),
    数量: Number(input.数量),
    单位: input.单位.trim() || '项',
    供货单位: input.供货单位.trim() || '未登记单位',
    验收日期: input.验收日期 || formatDate(new Date()),
    登记时间: time,
    登记来源: '上报',
    版本: 1,
    材料状态: '已验收',
  }
  saveMaterials([...rows, row])
  return { ok: true, message: '材料上报已登记' }
}

export function importMaterial(input: {
  材料编号: string
  材料名称: string
  批次号: string
  数量: number
  单位: string
  供货单位: string
  验收日期: string
}): ActionResult {
  if (!input.材料编号.trim()) return { ok: false, message: '材料编号必须填写' }
  if (!Number.isFinite(Number(input.数量)) || Number(input.数量) < 0) {
    return { ok: false, message: '数量必须是不小于 0 的数字' }
  }
  const rows = rowsAs<MaterialRow>('materials')
  if (rows.some((row) => row.登记来源 === '导入' && row.材料编号 === input.材料编号.trim())) {
    return { ok: false, message: '同一材料编号已导入，重复导入只保留最早版本，未新增一行' }
  }
  const row: MaterialRow = {
    id: nextId('materials'),
    status: '已验收',
    pending: false,
    abnormal: false,
    材料编号: input.材料编号.trim(),
    材料名称: input.材料名称.trim() || '未命名材料',
    批次号: input.批次号.trim() || '未登记批次',
    数量: Number(input.数量),
    单位: input.单位.trim() || '项',
    供货单位: input.供货单位.trim() || '未登记单位',
    验收日期: input.验收日期 || formatDate(new Date()),
    登记时间: nowTime(),
    登记来源: '导入',
    版本: 1,
    材料状态: '已验收',
  }
  saveMaterials([...rows, row])
  return { ok: true, message: '材料导入成功' }
}

export function exportMaterialsCsv(): { filename: string; content: string } {
  const header = ['材料编号', '材料名称', '批次号', '数量', '单位', '供货单位', '验收日期', '登记来源', '版本']
  const lines = [header.join(','), ...listMaterials().map((row) => header.map((field) => row[field as keyof MaterialRow] ?? '').join(','))]
  return {
    filename: '材料验收明细清单.csv',
    content: `﻿${lines.join('\n')}`,
  }
}

export function downloadCsv(file: { filename: string; content: string }): void {
  const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export { formatDateTime }
