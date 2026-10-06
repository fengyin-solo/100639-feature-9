/* 临时冒烟测试：验证 localStorage 旧格式升级与存量迁移。 */
import assert from 'node:assert'

// 在引入 store 前装好 localStorage 桩，并预置一份「旧格式」数据（直接是条目映射，无 version）。
const legacyVentilationRow = {
  id: 3,
  status: '故障停机',
  pending: true,
  abnormal: true,
  机组编号: 'VENT-0003',
  所属舱室: '电力舱A段',
  风机型号: '通风系统运维样例3',
  运行模式: '通风系统运维样例3',
  送风风速: '通风系统运维样例3',
  启停时间: '2026-09-03',
  操作人员: '通风系统运维样例3',
  风机状态: '通风系统运维样例3',
}
const memory = new Map<string, string>([
  ['urban-utility-tunnel:entries', JSON.stringify({ ventilation: [legacyVentilationRow] })],
])
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
  },
}

const { listRows, listDispatchItems, storageKey } = await import('@/data/local-store')

const rows = listRows('ventilation')
assert.strictEqual(rows.length, 1, '旧格式里的通风行应保留')
const row = rows[0]
assert.strictEqual(row.停机原因, '历史故障停机，原因未登记，按启停时间补录')
assert.strictEqual(row.送风风速, null, '占位字符串应归一成空态')
assert.notStrictEqual(row.取数失败原因, '')
assert.strictEqual(row.启停时间, '2026-09-03', '已有启停时间不动')
assert.ok(Array.isArray(row.操作记录))

// 其他模块没存过的，用种子补上；派工清单从种子带过来。
assert.ok(listRows('envmonitor').length > 0, '缺失模块用种子补齐')
assert.ok(listDispatchItems().length > 0, '派工清单种子就位')

// 升级后写回的是版本化结构。
const persisted = JSON.parse(memory.get(storageKey())!) as { version: number; entries: unknown; dispatch: unknown }
assert.strictEqual(persisted.version, 2)
assert.ok(persisted.entries && typeof persisted.entries === 'object')
assert.ok(Array.isArray(persisted.dispatch))

console.log('ok - 旧格式存储升级：版本号、迁移回填、种子补齐全部生效')
