<template>
  <div class="cl-community">
    <img :src="qrUrl" alt="AIstudy 交流群二维码" />
    <div class="cl-community-text">
      <b>AIstudy 交流群</b>
      <span>QQ 群号：1134484439</span>
      <span>扫码加入，交流使用经验 / 反馈问题</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import qrUrl from "../assets/qq-group-qr.png";
</script>
