<template>
  <section class="page" data-module="ventilation">
    <header class="page-head">
      <div>
        <h2>通风系统运维管理</h2>
        <p class="page-desc">维护通风机组，围绕机组编号、所属舱室、风机型号、运行模式做登记、筛选与状态流转。送风风速取自现场，取不到时留空态，不与 0 混同。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openPanel('create')">登记通风机组</button>
        <button class="btn" type="button" @click="openPanel('import')">导入运行材料</button>
        <button class="btn" type="button" @click="exportRows">导出通风系统运维清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="panel === 'create'" class="panel">
      <h3>登记通风机组</h3>
      <div class="form-row">
        <label class="form-item">
          <span>机组编号（必填，判重字段）</span>
          <input v-model="createForm.机组编号" placeholder="如 VENT-0006" />
        </label>
        <label class="form-item">
          <span>所属舱室（必填）</span>
          <input v-model="createForm.所属舱室" placeholder="如 综合舱D段" />
        </label>
        <label class="form-item">
          <span>风机型号</span>
          <input v-model="createForm.风机型号" placeholder="如 HTF-II-8 轴流风机" />
        </label>
        <label class="form-item">
          <span>运行模式</span>
          <input v-model="createForm.运行模式" placeholder="如 连续送风" />
        </label>
        <label class="form-item">
          <span>操作人员</span>
          <input v-model="createForm.操作人员" placeholder="登记人" />
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="button" @click="submitCreate">确认登记</button>
        <button class="btn ghost" type="button" @click="closePanel">取消</button>
      </div>
    </div>

    <div v-if="panel === 'stop' || panel === 'fault'" class="panel">
      <h3>
        {{ panel === 'stop' ? '登记停机' : '上报故障' }}：{{ activeRow?.机组编号 }}（{{ activeRow?.所属舱室 }}）
      </h3>
      <div class="form-row">
        <label class="form-item">
          <span>{{ panel === 'stop' ? '停机原因' : '故障原因（即停机原因）' }}，必填</span>
          <input
            v-model="reasonText"
            :placeholder="panel === 'stop' ? '如 计划性检修停机' : '如 电机轴承过热，温度保护动作停机'"
          />
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="button" @click="submitReason">确认</button>
        <button class="btn ghost" type="button" @click="closePanel">取消</button>
      </div>
    </div>

    <div v-if="panel === 'opinion'" class="panel">
      <h3>登记处理意见：{{ activeRow?.机组编号 }}（{{ activeRow?.所属舱室 }}）</h3>
      <p class="section-desc">处理意见会同步回写到设施检修页的派工清单，两个入口取同一份。</p>
      <div class="form-row">
        <label class="form-item">
          <span>处理意见，必填</span>
          <textarea v-model="opinionText" placeholder="如 已联系检修班组，明日进场更换轴承"></textarea>
        </label>
      </div>
      <div class="panel-actions">
        <button class="btn primary" type="button" @click="submitOpinion">确认回写</button>
        <button class="btn ghost" type="button" @click="closePanel">取消</button>
      </div>
    </div>

    <div v-if="panel === 'import'" class="panel">
      <h3>导入运行材料</h3>
      <p class="section-desc">
        判重口径：批次按「批次号」判重，批内行按「机组编号」判重。同一批次号重复导入只留最早那一版；
        新批次再报同一机组，只留最新那版，不把两版并在一起。
      </p>
      <textarea
        v-model="importText"
        placeholder='{"批次号":"VENT-IMP-20261006-01","验收日期":"2026-10-06","rows":[{"机组编号":"VENT-0001","所属舱室":"综合舱A段","风机型号":"HTF-II-8 轴流风机","运行模式":"连续送风","送风风速":3.4,"操作人员":"王工"}]}'
      ></textarea>
      <div class="panel-actions">
        <button class="btn primary" type="button" @click="submitImport">确认导入</button>
        <button class="btn ghost" type="button" @click="closePanel">取消</button>
      </div>
    </div>

    <p v-if="okMessage" class="ok-text">{{ okMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '送风风速'">
              <template v-if="row.送风风速 === null || row.送风风速 === undefined">
                <span class="empty-value">暂无</span>
                <span class="empty-reason">{{ row.取数失败原因 || '未取到送风风速' }}</span>
                <button class="link cell-retry" type="button" @click="retryFetch(row)">重新取数</button>
              </template>
              <template v-else>{{ row.送风风速 }} m/s</template>
            </template>
            <template v-else-if="column === '停机原因'">
              <span :class="{ 'fault-text': row.status === '故障停机' }">{{ row.停机原因 || '—' }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="startUnit(row)">提交开机</button>
            <button class="link" type="button" @click="openReasonPanel('stop', row)">登记停机</button>
            <button class="link" type="button" @click="openReasonPanel('fault', row)">上报故障</button>
            <button
              v-if="row.status === '故障停机'"
              class="link"
              type="button"
              @click="openOpinionPanel(row)"
            >
              登记处理意见
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <template v-if="loadError">
              暂无内容：{{ loadError }}
              <button class="link cell-retry" type="button" @click="reload">重试</button>
            </template>
            <template v-else>暂无通风系统运维数据，可先登记通风机组</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条通风系统运维记录，状态合计 {{ statusTotal }} 台，报表与明细一致</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <section class="sub-section">
      <h3>通风故障派工清单</h3>
      <p class="section-desc">故障停机自动生成派工单，处理意见在通风页登记后回写此处；设施检修页读的是同一份。既有条目按验收日期归位，未验收的按登记时间推定。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>工单编号</th>
            <th>机组编号</th>
            <th>所属舱室</th>
            <th>故障原因</th>
            <th>处理意见</th>
            <th>登记时间</th>
            <th>验收日期</th>
            <th>工单状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in dispatchItems" :key="item.id">
            <td>{{ item.工单编号 }}</td>
            <td>{{ item.机组编号 }}</td>
            <td>{{ item.所属舱室 }}</td>
            <td>{{ item.故障原因 }}</td>
            <td>{{ item.处理意见 || '—' }}</td>
            <td>{{ item.登记时间 }}</td>
            <td>{{ item.验收日期 ?? '未验收' }}</td>
            <td>{{ item.status }}</td>
          </tr>
          <tr v-if="!dispatchItems.length">
            <td colspan="8" class="empty-state">暂无派工单，机组故障停机后自动生成</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="sub-section">
      <h3>已导入批次</h3>
      <p class="section-desc">按验收日期归位；同一批次号重复导入不会多出一行。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次号</th>
            <th>验收日期</th>
            <th>登记时间</th>
            <th>行数</th>
            <th>新增</th>
            <th>覆盖更新</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in batches" :key="batch.批次号">
            <td>{{ batch.批次号 }}</td>
            <td>{{ batch.验收日期 }}</td>
            <td>{{ batch.登记时间 }}</td>
            <td>{{ batch.行数 }}</td>
            <td>{{ batch.新增 }}</td>
            <td>{{ batch.更新 }}</td>
          </tr>
          <tr v-if="!batches.length">
            <td colspan="6" class="empty-state">暂无导入批次，可从「导入运行材料」入口导入</td>
          </tr>
        </tbody>
      </table>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  createVentilationUnit,
  downloadEntries,
  fetchAirSpeed,
  importVentilationBatch,
  listBatches,
  listDispatch,
  listEntries,
  moduleMeta,
  reportVentilationFault,
  saveHandlingOpinion,
  startVentilation,
  stopVentilation,
} from '@/api/local-service'
import type { DispatchItem, EntryRow, ImportBatch } from '@/data/types'

const meta = moduleMeta('ventilation')
// 列直接取模块登记的字段，导出清单与页面明细天然一致。
const columns = meta.fields
const statuses = meta.statuses

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const loadError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const dispatchItems = ref<DispatchItem[]>([])
const batches = ref<ImportBatch[]>([])

type PanelKind = '' | 'create' | 'stop' | 'fault' | 'opinion' | 'import'
const panel = ref<PanelKind>('')
const activeRow = ref<EntryRow | null>(null)
const reasonText = ref('')
const opinionText = ref('')
const importText = ref('')
const createForm = ref({ 机组编号: '', 所属舱室: '', 风机型号: '', 运行模式: '', 操作人员: '' })

// 报表口径：统计卡片与下方明细清单用同一批数据计算，两边必须对得上。
const stats = computed(() => [
  { label: '运行中风机', value: rows.value.filter((row) => row.status === '运行中').length },
  { label: '已停机风机', value: rows.value.filter((row) => row.status === '已停机').length },
  { label: '故障停机风机', value: rows.value.filter((row) => row.status === '故障停机').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const statusTotal = computed(() => statusSummary.value.reduce((sum, item) => sum + item.count, 0))

function showResult(result: { ok: boolean; message: string }) {
  if (result.ok) {
    okMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    okMessage.value = ''
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openPanel(kind: PanelKind) {
  panel.value = panel.value === kind ? '' : kind
}

function closePanel() {
  panel.value = ''
  activeRow.value = null
  reasonText.value = ''
  opinionText.value = ''
}

function openReasonPanel(kind: 'stop' | 'fault', row: EntryRow) {
  activeRow.value = row
  reasonText.value = ''
  panel.value = kind
}

function openOpinionPanel(row: EntryRow) {
  activeRow.value = row
  opinionText.value = String(row.处理意见 ?? '')
  panel.value = 'opinion'
}

function submitCreate() {
  const result = createVentilationUnit({ ...createForm.value })
  showResult(result)
  if (result.ok) {
    createForm.value = { 机组编号: '', 所属舱室: '', 风机型号: '', 运行模式: '', 操作人员: '' }
    closePanel()
    reload()
  }
}

function submitReason() {
  if (!activeRow.value) {
    return
  }
  const id = Number(activeRow.value.id)
  const result =
    panel.value === 'stop' ? stopVentilation(id, reasonText.value) : reportVentilationFault(id, reasonText.value)
  showResult(result)
  if (result.ok) {
    closePanel()
    reload()
  }
}

function submitOpinion() {
  if (!activeRow.value) {
    return
  }
  const result = saveHandlingOpinion(Number(activeRow.value.id), opinionText.value)
  showResult(result)
  if (result.ok) {
    closePanel()
    reload()
  }
}

function submitImport() {
  const result = importVentilationBatch(importText.value)
  showResult(result)
  if (result.ok) {
    importText.value = ''
    closePanel()
    reload()
  }
}

function startUnit(row: EntryRow) {
  showResult(startVentilation(Number(row.id)))
  reload()
}

function retryFetch(row: EntryRow) {
  showResult(fetchAirSpeed(Number(row.id)))
  reload()
}

function reload() {
  errorMessage.value = ''
  okMessage.value = ''
  loadError.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    dispatchItems.value = listDispatch()
    batches.value = listBatches()
  } catch (error) {
    rows.value = []
    total.value = 0
    loadError.value = error instanceof Error ? error.message : '通风系统运维列表读取失败'
  }
}

onMounted(reload)
</script>
