<template>
  <div class="modal-mask open" @click.self="close">
    <div class="modal" role="dialog" aria-modal="true" aria-label="AIstudy 交流群">
      <h2>AIstudy 交流群</h2>
      <CommunityCard />
      <div class="modal-actions">
        <button class="btn primary" @click="close">知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useModalStore } from "../stores/modal";
import CommunityCard from "./CommunityCard.vue";

const modalStore = useModalStore();

function close(): void {
  modalStore.closeCommunity();
}
</script>
