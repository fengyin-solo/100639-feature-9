<template>
  <section class="page" data-module="maintenance">
    <header class="page-head">
      <div>
        <h2>设施检修管理管理</h2>
        <p class="page-desc">维护检修记录，围绕检修编号、检修对象、检修类别、检修班组做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检修记录</button>
        <button class="btn" type="button" @click="exportRows">导出设施检修管理清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="sub-section">
      <h3>通风故障派工清单</h3>
      <p class="section-desc">与通风系统运维页取同一份派工数据；处理意见由通风页登记后回写，两处一致。既有条目按验收日期归位。</p>
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
            <td colspan="8" class="empty-state">暂无派工单</td>
          </tr>
        </tbody>
      </table>
    </section>

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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无设施检修管理数据，可先登记检修记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条设施检修管理记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listDispatch,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { DispatchItem, EntryRow } from '@/data/types'

const meta = moduleMeta('maintenance')
const columns = ["检修编号", "检修对象", "检修类别", "检修班组", "计划工期", "完工日期", "更换部件", "检修状态"]
const actions = ["提交开工", "确认完工", "申请延期"]
const statuses = ["待开工", "检修中", "已完工", "已延期"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const dispatchItems = ref<DispatchItem[]>([])

// 报表口径：统计卡片与明细清单用同一批数据计算，两边对得上。
const stats = computed(() => [
  { label: '待开工检修', value: rows.value.filter((row) => row.status === '待开工').length },
  { label: '检修中记录', value: rows.value.filter((row) => row.status === '检修中').length },
  { label: '本月完工数', value: rows.value.filter((row) => row.status === '已完工').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '检修记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    dispatchItems.value = listDispatch()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '设施检修管理列表读取失败'
  }
}

onMounted(reload)
</script>
