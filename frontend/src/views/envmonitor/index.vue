<template>
  <section class="page" data-module="envmonitor">
    <header class="page-head">
      <div>
        <h2>廊内环境监测管理</h2>
        <p class="page-desc">维护环境监测记录，围绕监测编号、监测点位、环境温度、空气湿度做登记、筛选与状态流转。监测数据取不到时留空态并写明原因。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记环境监测记录</button>
        <button class="btn" type="button" @click="exportRows">导出廊内环境监测清单</button>
      </div>
    </header>

    <div v-if="stoppedCabins.length" class="notice-bar">
      通风联动提示：{{ stoppedCabins.map((item) => `${item.舱室} 通风已停（${item.提示}）`).join('；') }}。
      涉及舱室的监测数据请结合通风停机情况研判。
    </div>

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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>通风联动</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="isMetricField(column) && (row[column] === null || row[column] === undefined || row[column] === '')">
              <span class="empty-value">暂无</span>
              <span class="empty-reason">
                {{ row.采集失败原因 || '未取到监测数据' }}{{ cabinNotice(row) ? `；${cabinNotice(row)}` : '' }}
              </span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            <span v-if="cabinNotice(row)" class="fault-text">{{ cabinNotice(row) }}</span>
            <span v-else>—</span>
          </td>
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
          <td :colspan="columns.length + 3" class="empty-state">
            <template v-if="loadError">
              暂无内容：{{ loadError }}
              <button class="link cell-retry" type="button" @click="reload">重试</button>
            </template>
            <template v-else>暂无廊内环境监测数据，可先登记环境监测记录</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条廊内环境监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  cabinVentilationNotice,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  stoppedVentilationByCabin,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('envmonitor')
const columns = ["监测编号", "监测点位", "环境温度", "空气湿度", "氧气浓度", "有害气体浓度", "采集时间", "监测状态"]
const actions = ["提交采集", "判定正常", "标记超标"]
const statuses = ["待采集", "已采集", "指标正常", "指标超标"]
// 这四个是现场采集的指标列：取不到时留空态，写暂无与原因，不与 0 混同。
const metricFields = ["环境温度", "空气湿度", "氧气浓度", "有害气体浓度"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const loadError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stoppedCabins = ref<{ 舱室: string; 提示: string }[]>([])

// 报表口径：统计卡片与明细清单用同一批数据计算。
const stats = computed(() => [
  { label: '待采集点位', value: rows.value.filter((row) => row.status === '待采集').length },
  { label: '指标正常点位', value: rows.value.filter((row) => row.status === '指标正常').length },
  { label: '指标超标点位', value: rows.value.filter((row) => row.status === '指标超标').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isMetricField(column: string): boolean {
  return metricFields.includes(column)
}

function cabinNotice(row: EntryRow): string {
  return cabinVentilationNotice(String(row.监测点位 ?? ''))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '环境监测记录登记入口尚未接入审批流'
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
  loadError.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stoppedCabins.value = stoppedVentilationByCabin()
  } catch (error) {
    rows.value = []
    total.value = 0
    loadError.value = error instanceof Error ? error.message : '廊内环境监测列表读取失败'
  }
}

onMounted(reload)
</script>
