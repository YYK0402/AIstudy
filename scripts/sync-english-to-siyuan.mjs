// 把英语课程种子数据落库思源：资料库 + 资料文档 + 章/节文档，并回写 data.json 的 docId
// 用法: node scripts/sync-english-to-siyuan.mjs
import fs from "node:fs";

const PORT = process.env.SIYUAN_PORT || "50421";
const API = `http://localhost:${PORT}/api`;

async function call(name, body) {
  const res = await fetch(`${API}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error(`${name} 失败: ${j.msg ?? JSON.stringify(j)}`);
  return j.data;
}

const data = JSON.parse(fs.readFileSync("dist/data/data.json", "utf8"));
const course = data.courses.find((c) => c.name === "英语（专升本）");
if (!course) throw new Error("data.json 中未找到课程「英语（专升本）」");
// 修正种子写入的错误设置：课程文档在「AI 研习」笔记本下
data.settings = { ...data.settings, notebookName: "AI 研习" };

const notebooks = await call("notebook/lsNotebooks", {});
// 课程文档是「AI 研习」笔记本下的根文档，子文档路径以课程文档名为前缀
const notebook = (notebooks.notebooks ?? []).find((n) => n && n.name === "AI 研习");
if (!notebook) throw new Error("未找到笔记本「AI 研习」");
console.log("笔记本:", notebook.name, notebook.id);

const coursePath = `/${course.name}`;
const created = [];

async function createDoc(path, markdown) {
  const id = await call("filetree/createDocWithMd", {
    notebook: notebook.id,
    path,
    markdown,
  });
  created.push(path);
  console.log("  +", path, "→", id);
  return id;
}

// 1. 资料库目录文档
console.log("创建资料库…");
await createDoc(`${coursePath}/资料库`, "# 资料库");

// 2. 资料文档（全文落库）
for (const m of data.materials.filter((x) => x.courseId === course.id)) {
  console.log("资料:", m.name);
  m.siyuanDocId = await createDoc(
    `${coursePath}/资料库/${m.name}`,
    `# ${m.name}\n\n${m.contentText}`,
  );
}

// 3. 章节文档：章在课程文档下，节在章文档下
const chs = data.chapters.filter((c) => c.courseId === course.id);
for (const ch of chs) {
  const parent = ch.parentId ? chs.find((p) => p.id === ch.parentId) : null;
  const path = parent
    ? `${coursePath}/${parent.name}/${ch.name}`
    : `${coursePath}/${ch.name}`;
  ch.siyuanBlockId = await createDoc(path, `# ${ch.name}`);
}

fs.writeFileSync("dist/data/data.json", JSON.stringify(data));
console.log(`\n完成：新建文档 ${created.length} 个，data.json 已回写 docId`);
