<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>派工清单</h2>
        <p class="page-desc">通风故障的处理意见回写到这里；通风运维页与本入口读取同一 localStorage 数据源，不做两份快照。</p>
      </div>
      <button class="btn" type="button" @click="reload">刷新派工清单</button>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待处理</span>
        <strong class="stat-value">{{ countByState('待处理') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">处理中</span>
        <strong class="stat-value">{{ countByState('处理中') }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已完成</span>
        <strong class="stat-value">{{ countByState('已完成') }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>机组编号 / 舱室</span>
        <input v-model="keyword" placeholder="按机组编号、舱室或工体检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="keyword = ''">重置</button>
    </form>

    <table class="data-table domain-table">
      <thead>
        <tr>
          <th>工单编号</th>
          <th>来源</th>
          <th>机组编号</th>
          <th>所属舱室</th>
          <th>异常描述</th>
          <th>处理意见</th>
          <th>派工状态</th>
          <th>派工时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.id">
          <td>{{ row.工单编号 }}</td>
          <td>{{ row.来源模块 }}</td>
          <td>{{ row.来源记录 }}</td>
          <td>{{ row.所属舱室 }}</td>
          <td>{{ row.异常描述 }}</td>
          <td>
            <textarea v-model="drafts[row.id].处理意见" rows="3" class="opinion-input"></textarea>
          </td>
          <td>
            <select v-model="drafts[row.id].派工状态">
              <option v-for="state in states" :key="state" :value="state">{{ state }}</option>
            </select>
          </td>
          <td>{{ row.派工时间 }}</td>
          <td>
            <button class="btn primary" type="button" @click="save(row.id)">回写意见</button>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td colspan="9" class="empty-state">
            <strong>暂无派工单</strong>
            <p>暂无内容：当前没有匹配的故障派工。通风机组上报故障后会自动写入同一份清单。</p>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>判重口径：同一通风机组在未完成工单期间只保留一张未关闭派工单。</span>
      <span v-if="notice" :class="noticeOk ? 'success-text' : 'error-text'">{{ notice }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { listWorkOrders, updateWorkOrder } from '@/api/domain-service'
import type { WorkOrderRow } from '@/data/types'

const states = ['待处理', '处理中', '已完成'] as const
const rows = ref<WorkOrderRow[]>([])
const keyword = ref('')
const notice = ref('')
const noticeOk = ref(false)
const drafts = reactive<Record<number, { 处理意见: string; 派工状态: WorkOrderRow['派工状态'] }>>({})

const filteredRows = computed(() => rows.value.filter((row) => {
  const word = keyword.value.trim()
  if (!word) return true
  return [row.工单编号, row.来源记录, row.所属舱室, row.异常描述].some((value) => value.includes(word))
}))

function countByState(state: WorkOrderRow['派工状态']) {
  return rows.value.filter((row) => row.派工状态 === state).length
}

function reload() {
  rows.value = listWorkOrders()
  for (const row of rows.value) {
    if (!drafts[row.id]) {
      drafts[row.id] = { 处理意见: row.处理意见, 派工状态: row.派工状态 }
    }
  }
}

function save(id: number) {
  const draft = drafts[id]
  const result = updateWorkOrder(id, draft)
  noticeOk.value = result.ok
  notice.value = result.message
  reload()
}

onMounted(reload)
</script>
