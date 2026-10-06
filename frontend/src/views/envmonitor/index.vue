<template>
  <section class="page" data-module="envmonitor">
    <header class="page-head">
      <div>
        <h2>廊内环境监测管理</h2>
        <p class="page-desc">环境指标取数失败显示空态，不填 0；所属舱室通风停止时，在监测页同步说明通风状态。</p>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <div v-if="stoppedCabins.length" class="rule-banner warning-banner">
      <strong>通风联动：</strong>
      以下监测舱室通风已停：{{ stoppedCabins.join('、') }}。环境读数可能持续变化，进入前请先确认通风处置。
    </div>

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
          <th>通风联动</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-warning': row.abnormal || row.stopped }">
          <td v-for="column in columns" :key="column">
            <template v-if="metricFields.includes(column as MetricField)">
              <span v-if="row.取数状态 === 'failed'" class="metric-empty">暂无</span>
              <strong v-else>{{ row[column as MetricField] }}</strong>
              <div v-if="row.取数状态 === 'failed'" class="cell-error">
                取数失败：{{ row.取数失败原因 }}
              </div>
            </template>
            <template v-else-if="column === '采集时间'">
              <span v-if="row.采集时间">{{ row.采集时间 }}</span>
              <span v-else class="metric-empty">暂无</span>
            </template>
            <template v-else-if="column === '监测状态'">
              <span :class="['status-pill', row.abnormal ? 'status-fault' : 'status-running']">{{ row.监测状态 }}</span>
            </template>
            <template v-else>{{ row[column as keyof typeof row] }}</template>
          </td>
          <td>
            <span :class="row.stopped ? 'cell-error' : 'cell-note'">{{ row.ventilationText }}</span>
          </td>
          <td>
            <button v-if="row.取数状态 === 'failed'" class="link" type="button" @click="retry(row)">重新取一次</button>
            <span v-else class="cell-note">无需重试</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <strong>暂无环境监测数据</strong>
            <p>暂无内容：当前没有匹配的监测点。请检查筛选条件，或先登记监测编号和监测点位。</p>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条环境监测记录；null 为空态，有害气体实测 0 才显示 0。</span>
      <span v-if="notice" :class="noticeOk ? 'success-text' : 'error-text'">{{ notice }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { envRowsWithVentilation, retryEnvFetch } from '@/api/domain-service'
import type { EnvMonitorRow } from '@/data/types'

type EnvJoined = EnvMonitorRow & { ventilationText: string; stopped: boolean }
type MetricField = '环境温度' | '空气湿度' | '氧气浓度' | '有害气体浓度'

const columns = ['监测编号', '监测点位', '环境温度', '空气湿度', '氧气浓度', '有害气体浓度', '采集时间', '监测状态']
const metricFields: MetricField[] = ['环境温度', '空气湿度', '氧气浓度', '有害气体浓度']
const filterFields = ['监测编号', '监测点位', '监测状态']

const rows = ref<EnvJoined[]>([])
const filters = ref<Record<string, string>>({})
const notice = ref('')
const noticeOk = ref(false)

const stats = computed(() => [
  { label: '监测点位', value: rows.value.length },
  { label: '取数失败', value: rows.value.filter((row) => row.取数状态 === 'failed').length },
  { label: '指标超标', value: rows.value.filter((row) => row.status === '指标超标').length },
  { label: '通风已停舱室', value: stoppedCabins.value.length },
])
const stoppedCabins = computed(() =>
  [...new Set(rows.value.filter((row) => row.stopped).map((row) => row.监测点位))],
)

function reload() {
  rows.value = envRowsWithVentilation(filters.value)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function retry(row: EnvJoined) {
  const result = retryEnvFetch(row.id)
  noticeOk.value = result.ok
  notice.value = result.message
  reload()
}

onMounted(reload)
</script>
