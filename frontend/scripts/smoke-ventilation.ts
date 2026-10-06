/* 临时冒烟测试：用 esbuild 打包后在 node 里跑，验证通风运维服务逻辑。 */
import assert from 'node:assert'

import { migrateRows } from '@/data/migrations'
import {
  fetchAirSpeed,
  importVentilationBatch,
  listBatches,
  listDispatch,
  reportVentilationFault,
  saveHandlingOpinion,
  startVentilation,
  cabinVentilationNotice,
  stoppedVentilationByCabin,
  createVentilationUnit,
  listEntries,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`ok - ${name}`)
}

// 1. 存量迁移：早年故障停机没登记停机原因的，按规则补录；缺启停时间的按最早一次动作推定。
check('迁移：停机原因补录 + 启停时间按最早动作推定 + 风速空态', () => {
  const legacy: EntryRow[] = [
    {
      id: 9,
      status: '故障停机',
      pending: true,
      abnormal: true,
      机组编号: 'VENT-OLD1',
      所属舱室: '综合舱X段',
      送风风速: '通风系统运维样例1', // 早年占位字符串
      操作记录: [
        { 时间: '2019-03-01 08:00:00', 动作: '提交开机' },
        { 时间: '2020-05-01 09:00:00', 动作: '上报故障' },
      ],
    } as unknown as EntryRow,
    {
      id: 10,
      status: '已停机',
      pending: false,
      abnormal: false,
      机组编号: 'VENT-OLD2',
      所属舱室: '综合舱Y段',
      送风风速: 0, // 真实测量值 0，不许被置空
    } as unknown as EntryRow,
  ]
  const migrated = migrateRows('ventilation', legacy)
  assert.strictEqual(migrated[0].停机原因, '历史故障停机，原因未登记，按启停时间补录')
  assert.strictEqual(migrated[0].启停时间, '2019-03-01 08:00:00') // 最早一次动作推定
  assert.strictEqual(migrated[0].送风风速, null) // 占位字符串 → 空态
  assert.notStrictEqual(migrated[0].取数失败原因, '')
  assert.strictEqual(migrated[1].停机原因, '计划性停机（历史数据补录）')
  assert.strictEqual(migrated[1].送风风速, 0) // 0 是测量值，保留
})

// 2. 取数：故障/停机/待开机失败有原因；VENT-0002 第一次失败、重试成功。
check('取数：停机机组写明原因，运行机组重试后成功', () => {
  const fault = fetchAirSpeed(3)
  assert.strictEqual(fault.ok, false)
  assert.match(fault.message, /故障停机/)
  const stopped = fetchAirSpeed(4)
  assert.strictEqual(stopped.ok, false)
  assert.match(stopped.message, /已停机/)
  const first = fetchAirSpeed(2)
  assert.strictEqual(first.ok, false)
  assert.match(first.message, /网关超时/)
  const retry = fetchAirSpeed(2)
  assert.strictEqual(retry.ok, true)
  const row = listEntries('ventilation').items.find((r) => r.id === 2)!
  assert.strictEqual(typeof row.送风风速, 'number')
  assert.strictEqual(row.取数失败原因, '')
})

// 3. 故障幂等：同一机组重复上报只记一次，派工单也只有一张。
check('故障上报幂等 + 派工单不重复', () => {
  const before = listDispatch().filter((d) => d.机组编号 === 'VENT-0001' && d.status === '待处理')
  assert.strictEqual(before.length, 0)
  const first = reportVentilationFault(1, '电机异响，振动超限')
  assert.strictEqual(first.ok, true)
  const again = reportVentilationFault(1, '电机异响，振动超限')
  assert.strictEqual(again.ok, true)
  assert.match(again.message, /已登记/)
  const open = listDispatch().filter((d) => d.机组编号 === 'VENT-0001' && d.status === '待处理')
  assert.strictEqual(open.length, 1) // 反复点不会重复置故障、不重复派工
  const row = listEntries('ventilation').items.find((r) => r.id === 1)!
  assert.strictEqual(row.status, '故障停机')
  assert.strictEqual((row.操作记录 as unknown[]).filter((l) => String((l as { 动作: string }).动作).startsWith('上报故障')).length, 1)
})

// 4. 处理意见回写：机组与派工单两边是同一份。
check('处理意见回写派工清单，两边一致', () => {
  const result = saveHandlingOpinion(1, '已联系检修班组，明日进场更换轴承')
  assert.strictEqual(result.ok, true)
  const row = listEntries('ventilation').items.find((r) => r.id === 1)!
  const dispatch = listDispatch().find((d) => d.机组编号 === 'VENT-0001' && d.status === '待处理')!
  assert.strictEqual(row.处理意见, '已联系检修班组，明日进场更换轴承')
  assert.strictEqual(dispatch.处理意见, row.处理意见)
})

// 5. 开机办结派工单，验收日期归位。
check('开机后派工单办结并写验收日期', () => {
  const result = startVentilation(1)
  assert.strictEqual(result.ok, true)
  const dispatch = listDispatch().find((d) => d.机组编号 === 'VENT-0001')!
  assert.strictEqual(dispatch.status, '已办结')
  assert.strictEqual(typeof dispatch.验收日期, 'string')
})

// 6. 材料导入判重：重复批次只留最早一版；同机组新批次只留最新版；0 不当空值。
check('导入：批次号判重 + 机组编号判重 + 空值与0区分', () => {
  const batch1 = JSON.stringify({
    批次号: 'VENT-IMP-TEST-01',
    验收日期: '2026-10-06',
    rows: [
      { 机组编号: 'VENT-0005', 所属舱室: '综合舱C段', 风机型号: 'HTF-II-8', 运行模式: '连续送风', 送风风速: 0, 操作人员: '王工' },
      { 机组编号: 'VENT-0009', 所属舱室: '综合舱D段', 风机型号: 'GYF-3', 运行模式: '间歇送风', 送风风速: 2.8, 操作人员: '钱工' },
    ],
  })
  const first = importVentilationBatch(batch1)
  assert.strictEqual(first.ok, true)
  assert.strictEqual(first.added, 1)
  assert.strictEqual(first.updated, 1)
  const countAfterFirst = listEntries('ventilation').total

  const dup = importVentilationBatch(batch1)
  assert.strictEqual(dup.ok, true)
  assert.strictEqual(dup.duplicated, true)
  assert.strictEqual(listEntries('ventilation').total, countAfterFirst) // 不会多出一行
  assert.strictEqual(listBatches().filter((b) => b.批次号 === 'VENT-IMP-TEST-01').length, 1)

  const row5 = () => listEntries('ventilation').items.find((r) => r.机组编号 === 'VENT-0005')!
  assert.strictEqual(row5().送风风速, 0) // 0 是上报的测量值，保留

  // 同一批材料再报一遍（新批次号、内容有更新）：只留最新那版，不并两版、不多行。
  const batch2 = JSON.stringify({
    批次号: 'VENT-IMP-TEST-02',
    验收日期: '2026-10-06',
    rows: [{ 机组编号: 'VENT-0005', 所属舱室: '综合舱C段东', 风机型号: 'HTF-II-9', 运行模式: '连续送风', 送风风速: 3.6, 操作人员: '周工' }],
  })
  const second = importVentilationBatch(batch2)
  assert.strictEqual(second.ok, true)
  assert.strictEqual(second.updated, 1)
  assert.strictEqual(listEntries('ventilation').total, countAfterFirst)
  assert.strictEqual(row5().送风风速, 3.6)
  assert.strictEqual(row5().所属舱室, '综合舱C段东')
  assert.strictEqual(row5().操作人员, '周工')
})

// 7. 登记判重：机组编号重复不重复登记。
check('登记：机组编号判重', () => {
  const first = createVentilationUnit({ 机组编号: 'VENT-0100', 所属舱室: '综合舱E段', 风机型号: '', 运行模式: '', 操作人员: '' })
  assert.strictEqual(first.ok, true)
  const dup = createVentilationUnit({ 机组编号: 'VENT-0100', 所属舱室: '综合舱E段', 风机型号: '', 运行模式: '', 操作人员: '' })
  assert.strictEqual(dup.ok, false)
  assert.match(dup.message, /判重口径：机组编号/)
})

// 8. 环境监测联动：停下来的机组在监测页能体现出来。
check('监测页联动：舱室通风已停提示', () => {
  const stopped = stoppedVentilationByCabin()
  assert.ok(stopped.some((item) => item.舱室 === '电力舱A段'))
  assert.ok(stopped.some((item) => item.舱室 === '燃气舱A段'))
  const notice = cabinVentilationNotice('电力舱A段')
  assert.match(notice, /本舱室通风已停/)
  assert.match(notice, /VENT-0003/)
  assert.strictEqual(cabinVentilationNotice('综合舱A段'), '')
})

console.log(`\n${passed} 项检查全部通过`)
