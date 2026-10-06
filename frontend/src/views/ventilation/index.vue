<template>
  <section class="page" data-module="ventilation">
    <header class="page-head">
      <div>
        <h2>通风系统运维管理</h2>
        <p class="page-desc">区分「实测为 0 的停机」和「null 取数失败」：机组编号、所属舱室照常登记，失败只留空态并支持重试。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记通风机组</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div class="rule-banner">
      <strong>判重口径：</strong>机组档案按「机组编号」判重；同一机组在一次未关闭故障中重复点「上报故障」只保留一次，不重复写入派工单。
      历史停机缺少原因时，计划停机补为「按计划停机推定」，故障停机补为「按故障停机推定」；缺启停时间按最早一次动作推定。
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

    <table class="data-table domain-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-warning': row.abnormal }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '送风风速'">
              <span v-if="row.送风风速 === null" class="metric-empty">暂无</span>
              <strong v-else>{{ row.送风风速 }}</strong>
              <small v-if="row.送风风速 === 0" class="cell-note">控制量为 0：机组已停</small>
              <div v-if="row.取数状态 === 'failed'" class="cell-error">
                取数失败：{{ row.取数失败原因 }}
                <button class="link" type="button" @click="retryFetch(row)">重新取一次</button>
              </div>
              <small v-else-if="row.取数状态 === 'not_collected'" class="cell-note">待开机，尚无现场风速</small>
            </template>
            <template v-else-if="column === '停机原因'">
              <span v-if="row.停机原因">{{ row.停机原因 }}</span>
              <span v-else class="metric-empty">—</span>
            </template>
            <template v-else-if="column === '派工处理意见'">
              <span v-if="workOpinion(row)">{{ workOpinion(row) }}</span>
              <span v-else class="metric-empty">—</span>
            </template>
            <template v-else>{{ displayValue(row, column) }}</template>
          </td>
          <td>
            <span :class="['status-pill', statusClass(row.status)]">{{ row.status }}</span>
          </td>
          <td class="row-actions vertical-actions">
            <button class="link" type="button" @click="start(row)" :disabled="row.status === '运行中'">提交开机</button>
            <button class="link" type="button" @click="openStop(row)">登记停机</button>
            <button class="link danger" type="button" @click="openFault(row)" :disabled="row.status === '故障停机'">上报故障</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <strong>暂无通风机组</strong>
            <p>暂无内容：当前筛选条件下没有机组记录；请登记机组编号和所属舱室后再进行运行操作。</p>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条通风机组记录；空值表示未取到，0 表示风机停转，两者不混用。</span>
      <span v-if="notice" :class="noticeOk ? 'success-text' : 'error-text'">{{ notice }}</span>
    </footer>

    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>登记通风机组</h3>
        <label v-for="field in createFields" :key="field">
          <span>{{ field }}<em v-if="requiredFields.includes(field)">*</em></span>
          <input v-model="createForm[field]" :placeholder="`请输入${field}`" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="submit">保存登记</button>
        </div>
      </form>
    </div>

    <div v-if="reasonOpen" class="modal-mask" @click.self="reasonOpen = false">
      <form class="modal" @submit.prevent="submitReason">
        <h3>{{ reasonMode === 'stop' ? '登记停机原因' : '上报故障停机原因' }}</h3>
        <p class="modal-hint">
          机组：{{ activeRow?.机组编号 }} · {{ activeRow?.所属舱室 }}
        </p>
        <label>
          <span>{{ reasonMode === 'stop' ? '停机原因' : '故障原因' }}<em>*</em></span>
          <textarea v-model="reasonText" rows="4" :placeholder="reasonMode === 'stop' ? '如：按节能计划停机' : '如：电机过载保护动作'"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="reasonOpen = false">取消</button>
          <button class="btn primary" type="submit">确认</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createVentilation,
  listVentilation,
  listWorkOrders,
  reportVentilationFault,
  retryVentilationFetch,
  startVentilation,
  stopVentilation,
} from '@/api/domain-service'
import type { VentilationRow, WorkOrderRow } from '@/data/types'

const columns = ['机组编号', '所属舱室', '风机型号', '运行模式', '送风风速', '启停时间', '操作人员', '停机原因', '派工处理意见', '最后取数时间']
const filterFields = ['机组编号', '所属舱室', '风机型号']
const statuses = ['待开机', '运行中', '已停机', '故障停机']
const createFields = ['机组编号', '所属舱室', '风机型号', '运行模式', '操作人员']
const requiredFields = ['机组编号', '所属舱室']

const rows = ref<VentilationRow[]>([])
const workOrders = ref<WorkOrderRow[]>([])
const filters = ref<Record<string, string>>({})
const notice = ref('')
const noticeOk = ref(false)
const createOpen = ref(false)
const createForm = reactive<Record<string, string>>({
  机组编号: '',
  所属舱室: '',
  风机型号: '',
  运行模式: '自动',
  操作人员: '值班员',
})
const reasonOpen = ref(false)
const reasonMode = ref<'stop' | 'fault'>('stop')
const reasonText = ref('')
const activeId = ref<number | null>(null)

const activeRow = computed(() => rows.value.find((row) => row.id === activeId.value) ?? null)
const statusSummary = computed(() =>
  statuses.map((status) => ({ status, count: rows.value.filter((row) => row.status === status).length })),
)
const stats = computed(() => [
  { label: '运行中风机', value: rows.value.filter((row) => row.status === '运行中').length },
  { label: '已停机风机', value: rows.value.filter((row) => row.status === '已停机').length },
  { label: '故障停机风机', value: rows.value.filter((row) => row.status === '故障停机').length },
  { label: '取数失败', value: rows.value.filter((row) => row.取数状态 === 'failed').length },
])

function showResult(ok: boolean, message: string) {
  noticeOk.value = ok
  notice.value = message
  reload()
}

function displayValue(row: VentilationRow, field: string) {
  const value = row[field]
  return value === null || value === '' ? '—' : value
}

function statusClass(status: string) {
  if (status === '运行中') return 'status-running'
  if (status === '已停机') return 'status-stopped'
  if (status === '故障停机') return 'status-fault'
  return 'status-pending'
}

function workOpinion(row: VentilationRow): string {
  return workOrders.value.find((order) => order.来源记录 === row.机组编号)?.处理意见 ?? ''
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  rows.value = listVentilation(filters.value)
  workOrders.value = listWorkOrders()
}

function openCreate() {
  Object.assign(createForm, { 机组编号: '', 所属舱室: '', 风机型号: '', 运行模式: '自动', 操作人员: '值班员' })
  createOpen.value = true
}

function submitCreate() {
  const result = createVentilation({
    机组编号: createForm.机组编号,
    所属舱室: createForm.所属舱室,
    风机型号: createForm.风机型号,
    运行模式: createForm.运行模式,
    操作人员: createForm.操作人员,
  })
  if (result.ok) createOpen.value = false
  showResult(result.ok, result.message)
}

function start(row: VentilationRow) {
  const result = startVentilation(row.id)
  showResult(result.ok, result.message)
}

function openStop(row: VentilationRow) {
  activeId.value = row.id
  reasonMode.value = 'stop'
  reasonText.value = ''
  reasonOpen.value = true
}

function openFault(row: VentilationRow) {
  activeId.value = row.id
  reasonMode.value = 'fault'
  reasonText.value = ''
  reasonOpen.value = true
}

function submitReason() {
  if (activeId.value === null) return
  const result = reasonMode.value === 'stop'
    ? stopVentilation(activeId.value, reasonText.value)
    : reportVentilationFault(activeId.value, reasonText.value)
  if (result.ok) reasonOpen.value = false
  showResult(result.ok, result.message)
}

function retryFetch(row: VentilationRow) {
  const result = retryVentilationFetch(row.id)
  showResult(result.ok, result.message)
}

onMounted(reload)
</script>
