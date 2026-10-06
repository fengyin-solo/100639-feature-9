/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 行上的一次动作记录：用于审计，也用于「早年没有登记时间的按最早一次动作推定」。 */
export type ActionLog = {
  时间: string
  动作: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  // 取不到的现场数据用 null 表示空态，与测量值 0 严格区分；操作记录是嵌套数组。
  [field: string]: string | number | boolean | null | ActionLog[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 派工清单条目：通风故障停机时生成，通风页与设施检修页读的是同一份。 */
export type DispatchItem = {
  id: number
  工单编号: string
  机组编号: string
  所属舱室: string
  故障原因: string
  处理意见: string
  登记时间: string
  验收日期: string | null
  status: '待处理' | '已办结'
}

/** 一批导入的运行材料：判重口径为「批次号」，批内行按「机组编号」判重。 */
export type ImportBatch = {
  批次号: string
  验收日期: string
  登记时间: string
  行数: number
  新增: number
  更新: number
}

export type ImportResult = ActionResult & {
  added: number
  updated: number
  duplicated: boolean
}
