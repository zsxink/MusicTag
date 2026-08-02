<script setup lang="ts">
// 字段列表（design.md §5 fields）：8 字段行。
// 歌名/作者/专辑/专辑作者/音轨号+总数/年份/流派/文件名（只读 mono）。
import FieldRow from './FieldRow.vue'
</script>

<template>
  <div class="fields">
    <FieldRow label="歌名" field="title" />
    <FieldRow label="作者" field="artist" />
    <FieldRow label="专辑" field="album" />
    <FieldRow label="专辑作者" field="album_artist" />
    <FieldRow label="音轨号" kind="track" />
    <FieldRow label="年份" field="year" />
    <FieldRow label="流派" field="genre" />
    <FieldRow label="文件名" kind="file" />
  </div>
</template>

<style scoped>
.fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
