/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type DataValue = string | number | boolean | null

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: DataValue
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

export type FetchState = 'success' | 'failed' | 'not_collected'

export type VentilationRow = EntryRow & {
  机组编号: string
  所属舱室: string
  风机型号: string
  运行模式: string
  送风风速: number | null
  取数状态: FetchState
  取数失败原因: string | null
  最后取数时间: string | null
  启停时间: string
  操作人员: string
  停机原因: string | null
  风机状态: string
  故障已上报: boolean
  登记时间: string
}

export type EnvMonitorRow = EntryRow & {
  监测编号: string
  监测点位: string
  环境温度: number | null
  空气湿度: number | null
  氧气浓度: number | null
  有害气体浓度: number | null
  取数状态: FetchState
  取数失败原因: string | null
  最后取数时间: string | null
  采集时间: string | null
  监测状态: string
  登记时间: string
}

export type WorkOrderRow = EntryRow & {
  工单编号: string
  来源模块: string
  来源记录: string
  所属舱室: string
  异常描述: string
  处理意见: string
  派工状态: '待处理' | '处理中' | '已完成'
  派工时间: string
}

export type MaterialRow = EntryRow & {
  材料编号: string
  材料名称: string
  批次号: string
  数量: number
  单位: string
  供货单位: string
  验收日期: string
  登记时间: string
  登记来源: '导入' | '上报'
  版本: number
  材料状态: string
}
