<template>
  <div class="modal-mask open" @click.self="close">
    <div class="modal modal--lg changelog-modal" role="dialog" aria-modal="true" :aria-label="title">
      <h2>{{ title }}</h2>
      <div class="changelog-body">
        <section v-for="entry in entries" :key="entry.version" class="cl-entry">
          <header class="cl-head">
            <span class="cl-version">v{{ entry.version }}</span>
            <span class="cl-date">{{ entry.date }}</span>
          </header>
          <p v-if="entry.intro" class="cl-intro">{{ entry.intro }}</p>
          <div class="cl-items">
            <template v-for="(item, i) in entry.items" :key="i">
              <div v-if="item.head" class="cl-sub">{{ item.head }}</div>
              <div class="cl-item">{{ item.text }}</div>
            </template>
          </div>
        </section>
        <p v-if="entries.length === 0" class="cl-empty">该版本暂无更新条目。</p>
      </div>
      <div class="modal-actions">
        <button class="btn primary" @click="close">知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useModalStore } from "../stores/modal";
import { CHANGELOG, changelogSince } from "../constants/changelog";

const modalStore = useModalStore();

// seenVersion 为 null → 全部历史（常驻「更新日志」）；为版本号 → 只显示其后的增量（更新说明）
const entries = computed(() => changelogSince(CHANGELOG, modalStore.changelogSeenVersion));
const title = computed(() => (modalStore.changelogSeenVersion == null ? "更新日志" : "更新说明"));

function close(): void {
  modalStore.closeChangelog();
}
</script>
