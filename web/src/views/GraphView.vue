<template>
  <div class="page">
    <div class="page-title"><h1>知识图谱</h1><div class="desc">前置关系 · 掌握度着色 · 点击查看详情</div></div>
    <div class="graph-wrap">
      <div class="graph-toolbar">
        <button class="btn sm ghost">＋ 手动连线</button>
        <button class="btn sm ghost">⟳ 自动布局</button>
        <button class="btn sm ghost">⤓ 写入思源文档</button>
        <div class="graph-legend">
          <span class="l"><i style="background:var(--as-accent)"></i>精通</span>
          <span class="l"><i style="background:var(--as-green)"></i>掌握</span>
          <span class="l"><i style="background:var(--as-blue)"></i>了解</span>
          <span class="l"><i style="background:var(--as-text-faint)"></i>未学习</span>
        </div>
      </div>
      <div class="empty-state" style="padding:120px 20px">
        <span class="ico">🕸️</span>
        暂无知识点<br />上传资料并由 AI 解析出知识点后，图谱会展示它们之间的关联
      </div>
    </div>
  </div>
</template>
