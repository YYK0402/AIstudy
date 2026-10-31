<template>
  <div class="card">
    <EmptyState compact icon="alert" :text="message">
      <button class="btn sm primary" @click="$emit('retry')">重新加载</button>
    </EmptyState>
  </div>
</template>

<script setup lang="ts">
import EmptyState from "./EmptyState.vue";

defineProps<{ message: string }>();
defineEmits<{ retry: [] }>();
</script>
