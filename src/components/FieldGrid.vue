<script setup lang="ts">
// 字段网格（design.md §5 fieldgrid）：两列布局 `1fr 200px`。
// 左列 = 字段列表（歌名/作者/专辑/专辑作者/音轨号+总数/年份/流派/文件名）；
// 右列 = 封面区（1:1 封面 + 空态占位 + 搜索封面按钮占位）。
import CoverPanel from './CoverPanel.vue'
import FieldList from './FieldList.vue'
</script>

<template>
  <div class="field-grid">
    <FieldList class="field-col" />
    <CoverPanel class="cover-col" />
  </div>
</template>

<style scoped>
.field-grid {
  display: grid;
  grid-template-columns: 1fr 200px;
  gap: 24px;
  align-items: start;
}

.field-col {
  min-width: 0;
}

.cover-col {
  width: 200px;
}
</style>
