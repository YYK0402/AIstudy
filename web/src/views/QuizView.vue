<template>
  <div class="page">
    <div class="page-title"><h1>刷题练习</h1><div class="desc">筛选 · 组卷 · 即时批改</div></div>
    <div class="card">
      <div class="empty-state">
        <span class="ico">✏️</span>
        暂无题目<br />可在「课程内容」中对知识点使用 AI 出题，或导入线下真题
      </div>
      <div style="display:flex;justify-content:center;margin-top:16px">
        <router-link to="/content" class="btn primary">前往课程内容</router-link>
      </div>
    </div>
  </div>
</template>
