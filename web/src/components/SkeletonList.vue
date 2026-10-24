<template>
  <div class="skeleton-list" role="status" aria-label="加载中">
    <div v-for="n in rows" :key="n" class="skeleton-row" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 3 });
</script>
