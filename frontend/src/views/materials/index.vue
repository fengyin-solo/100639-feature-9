<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>材料验收与导入</h2>
        <p class="page-desc">上报重版保留最新，导入重复保留最早；明细按验收日期归位，报表由同一份明细实时汇总。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportCsv">导出明细清单</button>
      </div>
    </header>

    <div class="rule-banner">
      <strong>判重与归位口径：</strong>
      同一批次重复上报按「批次号 + 材料编号」判重，覆盖为最新版本；导入按「材料编号」判重，重复导入保留最早版本。
      有验收日期按验收日期归位，缺登记时间按最早一次验收动作推定。报表合计与下方明细同源，不另做快照。
    </div>

    <div class="material-layout">
      <form class="entry-panel" @submit.prevent="submit">
        <h3>{{ mode === 'report' ? '材料验收上报' : '材料清单导入' }}</h3>
        <div class="mode-row">
          <button class="btn" :class="{ primary: mode === 'report' }" type="button" @click="mode = 'report'">上报新版</button>
          <button class="btn" :class="{ primary: mode === 'import' }" type="button" @click="mode = 'import'">导入清单</button>
        </div>
        <label v-for="field in fields" :key="field">
          <span>{{ field }}<em v-if="requiredFields.includes(field)">*</em></span>
          <input v-model="form[field]" :type="field === '数量' ? 'number' : 'text'" :placeholder="`请输入${field}`" />
        </label>
        <label>
          <span>验收日期*</span>
          <input v-model="form.验收日期" type="date" />
        </label>
        <button class="btn primary" type="submit">{{ mode === 'report' ? '提交上报' : '确认导入' }}</button>
        <button class="btn ghost" type="button" @click="fillExistingReport">填入已上报批次（可测试覆盖）</button>
      </form>

      <div class="table-panel">
        <div class="stat-row">
          <article class="stat-card">
            <span class="stat-label">明细行数（去重后）</span>
            <strong class="stat-value">{{ details.length }}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">报表覆盖行数</span>
            <strong class="stat-value">{{ reportRowCount }}</strong>
          </article>
          <article class="stat-card">
            <span class="stat-label">对账状态</span>
            <strong class="stat-value" :class="{ mismatch: !reconciled }">{{ reconciled ? '一致' : '不一致' }}</strong>
          </article>
        </div>

        <h3>按验收日期汇总报表</h3>
        <table class="data-table compact-table">
          <thead>
            <tr><th>验收日期</th><th>单位</th><th>明细行数</th><th>数量合计</th><th>包含材料</th></tr>
          </thead>
          <tbody>
            <tr v-for="summary in summaries" :key="`${summary.date}-${summary.unit}`">
              <td>{{ summary.date }}</td>
              <td>{{ summary.unit }}</td>
              <td>{{ summary.batches }}</td>
              <td>{{ summary.quantity }}</td>
              <td>{{ summary.items.map(item => `${item.材料编号} v${item.版本}`).join('、') }}</td>
            </tr>
          </tbody>
        </table>

        <h3>去重后的验收明细清单</h3>
        <form class="filter-bar compact-filter" @submit.prevent>
          <label class="filter-item">
            <span>检索</span>
            <input v-model="keyword" placeholder="编号、名称、批次" />
          </label>
          <select v-model="sourceFilter">
            <option value="">全部来源</option>
            <option value="上报">上报</option>
            <option value="导入">导入</option>
          </select>
        </form>
        <table class="data-table compact-table">
          <thead>
            <tr>
              <th v-for="column in detailColumns" :key="column">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredDetails" :key="row.id">
              <td v-for="column in detailColumns" :key="column">{{ row[column as keyof typeof row] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <footer class="page-foot">
      <span>对账结果：{{ reconciled ? '报表覆盖行数与明细行数一致' : '报表与明细不一致' }}</span>
      <span v-if="notice" :class="noticeOk ? 'success-text' : 'error-text'">{{ notice }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadCsv,
  exportMaterialsCsv,
  importMaterial,
  listMaterials,
  materialSummary,
  upsertReportedMaterial,
} from '@/api/domain-service'
import type { MaterialRow } from '@/data/types'

const fields = ['材料编号', '材料名称', '批次号', '数量', '单位', '供货单位'] as const
const requiredFields = ['材料编号', '材料名称', '批次号']
const detailColumns = ['材料编号', '材料名称', '批次号', '数量', '单位', '供货单位', '验收日期', '登记来源', '版本', '登记时间']

const details = ref<MaterialRow[]>([])
const mode = ref<'report' | 'import'>('report')
const keyword = ref('')
const sourceFilter = ref('')
const notice = ref('')
const noticeOk = ref(false)
const form = reactive<Record<string, string>>({
  材料编号: '',
  材料名称: '',
  批次号: '',
  数量: '10',
  单位: '件',
  供货单位: '',
  验收日期: '',
})

const summaries = computed(() => materialSummary())
const reportRowCount = computed(() => summaries.value.reduce((sum, item) => sum + item.batches, 0))
const reconciled = computed(() => reportRowCount.value === details.value.length)
const filteredDetails = computed(() => details.value.filter((row) => {
  const word = keyword.value.trim()
  const matchesWord = !word || [row.材料编号, row.材料名称, row.批次号].some((value) => value.includes(word))
  const matchesSource = !sourceFilter.value || row.登记来源 === sourceFilter.value
  return matchesWord && matchesSource
}))

function reload() {
  details.value = listMaterials()
}

function submit() {
  const payload = {
    材料编号: form.材料编号,
    材料名称: form.材料名称,
    批次号: form.批次号,
    数量: Number(form.数量),
    单位: form.单位,
    供货单位: form.供货单位,
    验收日期: form.验收日期,
  }
  const result = mode.value === 'report' ? upsertReportedMaterial(payload) : importMaterial(payload)
  noticeOk.value = result.ok
  notice.value = result.message
  reload()
}

function fillExistingReport() {
  mode.value = 'report'
  const existing = details.value.find((row) => row.登记来源 === '上报')
  if (!existing) return
  form.材料编号 = existing.材料编号
  form.材料名称 = `${existing.材料名称}（更新规格）`
  form.批次号 = existing.批次号
  form.数量 = String(existing.数量 + 2)
  form.单位 = existing.单位
  form.供货单位 = existing.供货单位
  form.验收日期 = existing.验收日期
}

function exportCsv() {
  downloadCsv(exportMaterialsCsv())
}

onMounted(() => {
  form.验收日期 = new Date().toISOString().slice(0, 10)
  reload()
})
</script>
