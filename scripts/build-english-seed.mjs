// 构建「英语（专升本）」课程种子数据 → dist/data/data.json
// 用法: node scripts/build-english-seed.mjs
// 说明: 插件数据经 loadData/saveData 存于 dist/data/data.json；clean 构建会清掉，重跑本脚本即可恢复
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { course, chapters } from "../seeds/english-zsb/meta.js";
import { kps } from "../seeds/english-zsb/kps.js";
import { readingPassages } from "../seeds/english-zsb/q-reading.js";
import { wordFillPassages, clozePassages, grammarDrills, lectureExercises } from "../seeds/english-zsb/q-fill.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nowIso = new Date().toISOString();
const COURSE_ID = course.id;

// ---------- 题目生成 ----------
const questions = [];
let qn = 1;
function addQuestion(q) {
  questions.push({
    id: qn++,
    courseId: COURSE_ID,
    kpIds: q.kpIds,
    title: q.title,
    options: JSON.stringify(q.options ?? []),
    answer: q.answer,
    analysis: q.analysis ?? "",
    qType: q.qType ?? "single",
    difficulty: q.difficulty ?? "medium",
    source: q.source ?? "import",
    paperId: null,
    createTime: nowIso,
  });
}

// 阅读类（篇章 + 题干，单选）
for (const p of readingPassages) {
  let qno = 0;
  for (const g of p.groups) {
    const letters = g.answers.replace(/\s+/g, " ").split(" ").filter(Boolean);
    if (letters.length !== g.questions.length) {
      throw new Error(`答案键长度不符: ${p.title} (${letters.length} vs ${g.questions.length})`);
    }
    for (let i = 0; i < g.questions.length; i++) {
      qno += 1;
      const q = g.questions[i];
      const options = q.options ?? g.options;
      const optIdx = letters[i].toUpperCase().charCodeAt(0) - 65;
      if (!options || optIdx < 0 || optIdx >= options.length) {
        throw new Error(`选项越界: ${p.title} 第${qno}题`);
      }
      const prefix = g.label ? `${g.label} ` : "";
      addQuestion({
        kpIds: p.kpIds,
        title: `【${p.title}】\n\n${p.passage}\n\n${prefix}${qno}. ${q.stem}`,
        options,
        answer: options[optIdx],
        source: p.source,
      });
    }
  }
}

// 填词补文（每空一题，12 选项）
for (const p of wordFillPassages) {
  const letters = p.answers.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (letters.length !== p.blankNos.length) {
    throw new Error(`答案键长度不符: ${p.title} (${letters.length} vs ${p.blankNos.length})`);
  }
  p.blankNos.forEach((no, i) => {
    addQuestion({
      kpIds: p.kpIds,
      title: `【${p.title}】\n\n${p.passage}\n\n第 ${no} 题：从 A-L 中选出填入空格 ${no} 的最佳选项`,
      options: p.options,
      answer: p.options[letters[i].toUpperCase().charCodeAt(0) - 65],
      source: p.source,
    });
  });
}

// 完形补文（每空一题，填空）
for (const p of clozePassages) {
  for (const b of p.blanks) {
    addQuestion({
      kpIds: p.kpIds,
      title: `【${p.title}】\n\n${p.passage}\n\n第 ${b.num} 题：用所给单词 ${b.hint} 的适当形式填空`,
      answer: b.answer,
      analysis: b.analysis,
      qType: "cloze",
      source: p.source,
    });
  }
}

// 语法专项真题带练（填空）
for (const sec of grammarDrills) {
  for (const it of sec.items) {
    addQuestion({
      kpIds: sec.kpIds,
      title: `【语法专项真题带练 · ${sec.label}】\n\n用所给单词的适当形式填空：\n${it.text}`,
      answer: it.answer,
      analysis: it.analysis,
      qType: "cloze",
      source: "学霸笔记 · 语法专项及真题带练",
    });
  }
}

// 精讲讲义配套小练习
for (const sec of lectureExercises) {
  for (const it of sec.items) {
    if (sec.single) {
      addQuestion({
        kpIds: sec.kpIds,
        title: `【精讲讲义练习 · ${sec.label}】\n\n${it.text}`,
        options: it.options,
        answer: it.answer,
        analysis: it.analysis,
        source: "精讲讲义 · 配套练习",
      });
    } else {
      addQuestion({
        kpIds: sec.kpIds,
        title: `【精讲讲义练习 · ${sec.label}】\n\n${it.text}`,
        answer: it.answer,
        analysis: it.analysis,
        qType: "cloze",
        source: "精讲讲义 · 配套练习",
      });
    }
  }
}

// ---------- 资料（MinerU 转换的 markdown 存于 seeds/english-zsb/docs） ----------
const docsDir = resolve(root, "seeds/english-zsb/docs");
const readDoc = (f) => readFileSync(resolve(docsDir, f), "utf8");
const materials = [
  {
    id: 1,
    courseId: COURSE_ID,
    name: "3.《英语（专升本）》精讲讲义（完整版）.pdf",
    assetPath: "assets/3.《英语（专升本）》精讲讲义（完整版）-20261025204051-8ulhofk.pdf",
    fileType: "pdf",
    contentText: readDoc("lecture.md"),
    headings: JSON.stringify([
      "语法专项", "填词补文篇", "完形补文篇", "阅读判断篇", "阅读选择篇",
      "概括段落大意和补全句子篇", "填句补文篇", "短文写作篇",
    ].map((text) => ({ level: 1, text }))),
    siyuanDocId: null,
    status: "parsed",
    createTime: nowIso,
    source: "upload",
  },
  {
    id: 2,
    courseId: COURSE_ID,
    name: "5.《英语（专升本）》十页纸.pdf",
    assetPath: "assets/5.《英语（专升本）》十页纸.pdf",
    fileType: "pdf",
    contentText: readDoc("tenpage.md"),
    headings: JSON.stringify([
      "【十页纸使用说明】", "一、阅读判断", "二、阅读选择", "三、概括段落大意和补全句子",
      "四、填句补文", "五、填词补文", "六、完形补文", "七、作文类型（套模板背诵）", "语法专项",
    ].map((text) => ({ level: 1, text }))),
    siyuanDocId: null,
    status: "parsed",
    createTime: nowIso,
    source: "upload",
  },
  {
    id: 3,
    courseId: COURSE_ID,
    name: "7.《英语（专升本）》学霸笔记.pdf",
    assetPath: "assets/7.《英语（专升本）》学霸笔记.pdf",
    fileType: "pdf",
    contentText: readDoc("notes.md"),
    headings: JSON.stringify([
      "学霸笔记内容", "考前备考建议", "一、英语（专升本）解题步骤与技巧",
      "二、语法专项及真题带练", "语法专项真题带练答案", "三、附录：高频词汇及变换形式",
    ].map((text) => ({ level: 1, text }))),
    siyuanDocId: null,
    status: "parsed",
    createTime: nowIso,
    source: "upload",
  },
];

const materialChapters = [];
let mc = 1;
for (const m of materials) {
  for (const ch of chapters.filter((c) => c.level === "chapter")) {
    materialChapters.push({ id: mc++, materialId: m.id, chapterId: ch.id });
  }
}

// ---------- 组装 AppData ----------
const knowledgePoints = kps.map((k) => ({
  id: k.id,
  courseId: COURSE_ID,
  chapterId: k.chapterId,
  blockId: null,
  name: k.name,
  content: k.content,
  mastery: "unlearn",
  sourceAssetIds: "",
  prevKpIds: "",
  tags: k.tags,
  chapterName: chapters.find((c) => c.id === k.chapterId)?.name ?? "",
  sort: k.id,
  createTime: nowIso,
}));

const chapterRows = chapters.map((c) => ({
  ...c,
  courseId: COURSE_ID,
  siyuanBlockId: null,
}));

const data = {
  providers: [],
  models: [],
  taskModels: [],
  logs: [],
  courses: [course],
  chapters: chapterRows,
  knowledgePoints,
  materials,
  materialChapters,
  questions,
  examPapers: [],
  answerRecords: [],
  wrongQuestions: [],
  studyPlans: [],
  studyTasks: [],
  explainRecords: [],
  reviewSchedules: [],
  flashCards: [],
  studyLogs: [],
  settings: {
    chapterMode: "manual",
    persistToSiyuan: true,
    // 课程文档统一建在「AI 研习」笔记本下（与课程 siyuanDocId 所在笔记本一致），勿用课程名
    notebookName: "AI 研习",
  },
};

// ---------- 写出 ----------
const outDir = resolve(root, "dist/data");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "data.json");
writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");

console.log(`已写入 ${outPath}`);
console.log(
  `课程 1 · 章节 ${chapterRows.length} · 知识点 ${knowledgePoints.length} · 资料 ${materials.length} · 题目 ${questions.length}`
);
