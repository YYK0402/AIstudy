<template>
  <div class="page">
    <div class="page-title"><h1>课程内容</h1><div class="desc">章节 · 单元 · 知识点 · 关联资料</div></div>
    <div class="two-col">
      <div class="card">
        <h3>目录结构</h3>
        <div class="empty-state">
          <span class="ico">🗂️</span>
          暂无章节，上传资料后由 AI 自动识别结构，或手动搭建
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn primary sm">＋ 上传资料</button>
          <button class="btn sm">✎ 手动添加章节</button>
        </div>
      </div>
      <div class="card">
        <h3>知识点</h3>
        <div class="empty-state">
          <span class="ico">📌</span>
          暂无知识点，选择左侧章节后查看或添加
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button class="btn sm">✎ 手动添加知识点</button>
        </div>
      </div>
    </div>
  </div>
</template>
