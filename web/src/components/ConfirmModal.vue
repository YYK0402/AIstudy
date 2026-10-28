<template>
  <div class="modal-mask" :class="{ open: modalStore.confirmOpen }" @click.self="settle(false)">
    <div class="modal confirm-modal" role="alertdialog" aria-modal="true" :aria-label="modalStore.confirmTitle">
      <h2>{{ modalStore.confirmTitle }}</h2>
      <p class="confirm-msg">{{ modalStore.confirmMessage }}</p>
      <div class="modal-actions">
        <button class="btn ghost" @click="settle(false)">取消</button>
        <button class="btn" :class="modalStore.confirmDanger ? 'danger-solid' : 'primary'" @click="settle(true)">
          {{ modalStore.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useModalStore } from "../stores/modal";
import { settleConfirm } from "../composables/useConfirm";

const modalStore = useModalStore();

function settle(ok: boolean): void {
  settleConfirm(ok);
}
</script>
