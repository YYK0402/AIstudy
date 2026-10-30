// 内置示例课数据（开箱即用）：静态、类型化、可移植（CoursePackageData 形状）。
// 内容为中国近代史（1840—1912）的事实性原创编撰，不含任何原始资料（IP 安全）。
// 包内 id 为本地占位（course=1 / chapters=1..4 / kps=1..12 / questions=101..120 /
// papers=301 / cards=201..210），添加时由 remapCoursePackage 重映射到接收方数据。
import type { CoursePackageData } from "../api/coursePackage";

const T = "2026-01-01T00:00:00.000Z";

export const SAMPLE_COURSE: CoursePackageData = {
  course: {
    id: 1,
    siyuanDocId: null,
    name: "示例课：中国近代史",
    description:
      "以 1840—1912 年中国近代史为线索，覆盖鸦片战争、洋务运动到辛亥革命的关键知识点，配现成题目、闪卡与两周学习计划，适合快速体验完整学习流程。",
    target: "掌握近代史核心脉络",
    totalCycle: "14 天",
    status: "active",
    createTime: T,
  },
  chapters: [
    { id: 1, courseId: 1, parentId: null, siyuanBlockId: null, name: "第一章 鸦片战争与南京条约", level: "chapter", sort: 1 },
    { id: 2, courseId: 1, parentId: null, siyuanBlockId: null, name: "第二章 战争的社会影响", level: "chapter", sort: 2 },
    { id: 3, courseId: 1, parentId: null, siyuanBlockId: null, name: "第三章 洋务运动", level: "chapter", sort: 3 },
    { id: 4, courseId: 1, parentId: null, siyuanBlockId: null, name: "第四章 辛亥革命", level: "chapter", sort: 4 },
  ],
  knowledgePoints: [
    {
      id: 1, courseId: 1, chapterId: 1, blockId: null, name: "鸦片战争爆发的背景",
      content:
        "鸦片战争前，英国为扭转对华贸易逆差，大量向中国走私鸦片，白银外流、兵员吸食成风。1839 年林则徐虎门销烟，成为战争爆发的直接导火索，英国以此为借口于 1840 年发动侵略战争。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "第一章 鸦片战争与南京条约", sort: 1, createTime: T,
    },
    {
      id: 2, courseId: 1, chapterId: 1, blockId: null, name: "《南京条约》的核心条款",
      content:
        "1842 年签订的《南京条约》是中国近代史上第一个不平等条约，主要条款包括：割让香港岛、赔款 2100 万银元、开放五口通商、协定关税。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "1", chapterName: "第一章 鸦片战争与南京条约", sort: 2, createTime: T,
    },
    {
      id: 3, courseId: 1, chapterId: 1, blockId: null, name: "五口通商与协定关税",
      content:
        "条约开放广州、福州、厦门、宁波、上海五处为通商口岸，并规定英商进出口货物应纳税饷须与英国商定，中国开始丧失关税自主权。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "2", chapterName: "第一章 鸦片战争与南京条约", sort: 3, createTime: T,
    },
    {
      id: 4, courseId: 1, chapterId: 2, blockId: null, name: "自然经济开始解体",
      content:
        "鸦片战争后，西方商品大量涌入，中国自给自足的自然经济开始解体，沿海传统手工业受到冲击，中国被迫卷入资本主义世界市场。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "第二章 战争的社会影响", sort: 1, createTime: T,
    },
    {
      id: 5, courseId: 1, chapterId: 2, blockId: null, name: "民族危机的加深",
      content:
        "《南京条约》之后，西方列强继续扩大侵略，相继攫取领事裁判权、片面最惠国待遇等特权，中国的主权与领土完整遭到严重破坏，民族危机不断加深。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "4", chapterName: "第二章 战争的社会影响", sort: 2, createTime: T,
    },
    {
      id: 6, courseId: 1, chapterId: 2, blockId: null, name: "早期思想启蒙（开眼看世界）",
      content:
        "面对危局，林则徐、魏源、徐继畬等主张「开眼看世界」，魏源编成《海国图志》，提出「师夷长技以制夷」，开启了近代向西方学习的思想潮流。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "5", chapterName: "第二章 战争的社会影响", sort: 3, createTime: T,
    },
    {
      id: 7, courseId: 1, chapterId: 3, blockId: null, name: "洋务运动的兴起背景",
      content:
        "第二次鸦片战争后，清政府面临内忧（太平天国运动）外患（列强侵略）的双重压力，洋务派主张利用西方先进生产技术维护清朝统治，洋务运动由此兴起。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "第三章 洋务运动", sort: 1, createTime: T,
    },
    {
      id: 8, courseId: 1, chapterId: 3, blockId: null, name: "「自强」与「求富」：洋务企业",
      content:
        "洋务运动前期以「自强」为口号，创办江南制造总局、福州船政局等军事工业；后期以「求富」为口号，创办轮船招商局、开平矿务局等民用工业。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "7", chapterName: "第三章 洋务运动", sort: 2, createTime: T,
    },
    {
      id: 9, courseId: 1, chapterId: 3, blockId: null, name: "甲午战争与洋务运动破产",
      content:
        "1894 年甲午战争爆发，清军战败，北洋水师全军覆没，签订《马关条约》，标志着洋务运动「师夷长技」以救亡图存的尝试宣告破产。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "8", chapterName: "第三章 洋务运动", sort: 3, createTime: T,
    },
    {
      id: 10, courseId: 1, chapterId: 4, blockId: null, name: "辛亥革命的背景与预备",
      content:
        "20 世纪初，列强掀起瓜分中国的狂潮，民族危机空前严重；清廷「预备立宪」与「新政」失败，未能挽救统治危机；革命思想广泛传播，同盟会等革命团体积极发动起义。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "", chapterName: "第四章 辛亥革命", sort: 1, createTime: T,
    },
    {
      id: 11, courseId: 1, chapterId: 4, blockId: null, name: "武昌起义与革命爆发",
      content:
        "1911 年 10 月 10 日，革命党人在湖北武昌发动起义，迅速占领武昌，史称「武昌起义」，成为辛亥革命的开端，此后各省纷纷响应，宣布脱离清廷独立。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "10", chapterName: "第四章 辛亥革命", sort: 2, createTime: T,
    },
    {
      id: 12, courseId: 1, chapterId: 4, blockId: null, name: "中华民国成立与《临时约法》",
      content:
        "1912 年 1 月 1 日，中华民国临时政府在南京成立，孙中山就任临时大总统；同年 3 月颁布《中华民国临时约法》，以法律形式确立民主共和政体，规定三权分立。",
      mastery: "unlearn", sourceAssetIds: "", prevKpIds: "11", chapterName: "第四章 辛亥革命", sort: 3, createTime: T,
    },
  ],
  materials: [],
  materialChapters: [],
  questions: [
    // 单选（8）
    { id: 101, courseId: 1, kpIds: "1", title: "1840 年，英国发动的侵略战争是？", options: JSON.stringify(["中法战争", "鸦片战争", "甲午战争", "八国联军侵华战争"]), answer: "B", analysis: "1840 年英国发动鸦片战争，中国近代史由此开端。", qType: "single", difficulty: "easy", source: "manual", paperId: 301, createTime: T },
    { id: 102, courseId: 1, kpIds: "2", title: "《南京条约》中割让给英国的领土是？", options: JSON.stringify(["香港岛", "澳门", "台湾", "九龙"]), answer: "A", analysis: "《南京条约》割让香港岛；澳门、九龙、台湾分属其他条约或事件。", qType: "single", difficulty: "easy", source: "manual", paperId: 301, createTime: T },
    { id: 103, courseId: 1, kpIds: "3", title: "下列不属于《南京条约》开放的通商口岸的是？", options: JSON.stringify(["上海", "宁波", "重庆", "广州"]), answer: "C", analysis: "五口通商为广州、福州、厦门、宁波、上海，不含重庆。", qType: "single", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 104, courseId: 1, kpIds: "4", title: "鸦片战争后，中国经济结构出现的重大变化是？", options: JSON.stringify(["自然经济开始解体", "自然经济完全瓦解", "计划经济建立", "重农抑商强化"]), answer: "A", analysis: "鸦片战争后自然经济开始解体，而非完全瓦解。", qType: "single", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 105, courseId: 1, kpIds: "8", title: "洋务运动前期与后期的口号分别是？", options: JSON.stringify(["自强、求富", "民主、科学", "实业救国、教育救国", "三民主义、五权宪法"]), answer: "A", analysis: "洋务运动前期「自强」、后期「求富」。", qType: "single", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 106, courseId: 1, kpIds: "8", title: "下列属于洋务派创办的民用企业的是？", options: JSON.stringify(["江南制造总局", "轮船招商局", "福州船政局", "安庆内军械所"]), answer: "B", analysis: "轮船招商局为民用企业；其余为军事工业。", qType: "single", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 107, courseId: 1, kpIds: "11", title: "1911 年 10 月 10 日爆发的起义是？", options: JSON.stringify(["金田起义", "武昌起义", "黄花岗起义", "广州起义"]), answer: "B", analysis: "1911 年 10 月 10 日武昌起义爆发，是辛亥革命的首义。", qType: "single", difficulty: "easy", source: "manual", paperId: 301, createTime: T },
    { id: 108, courseId: 1, kpIds: "12", title: "1912 年 1 月 1 日宣告成立的政权是？", options: JSON.stringify(["中华民国", "中华苏维埃共和国", "大清帝国", "中华共和国"]), answer: "A", analysis: "1912 年 1 月 1 日中华民国临时政府成立。", qType: "single", difficulty: "easy", source: "manual", paperId: 301, createTime: T },
    // 多选（4）
    { id: 109, courseId: 1, kpIds: "2,3", title: "《南京条约》的主要内容包括？（多选）", options: JSON.stringify(["割让香港岛", "赔款 2100 万银元", "开放五口通商", "协定关税", "割让台湾"]), answer: "A,B,C,D", analysis: "割让台湾见于《马关条约》，不属《南京条约》。", qType: "multiple", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 110, courseId: 1, kpIds: "4,6", title: "鸦片战争后「开眼看世界」的代表人物有？（多选）", options: JSON.stringify(["林则徐", "魏源", "徐继畬", "洪秀全"]), answer: "A,B,C", analysis: "洪秀全领导太平天国运动，不属「开眼看世界」思潮代表。", qType: "multiple", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 111, courseId: 1, kpIds: "8", title: "下列属于洋务派创办的军事工业的有？（多选）", options: JSON.stringify(["江南制造总局", "福州船政局", "安庆内军械所", "轮船招商局"]), answer: "A,B,C", analysis: "轮船招商局为民用企业，其余为军事工业。", qType: "multiple", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 112, courseId: 1, kpIds: "10,11", title: "辛亥革命爆发的背景因素包括？（多选）", options: JSON.stringify(["列强掀起瓜分狂潮", "清廷「预备立宪」失败", "革命思想与组织广泛传播", "洋务运动取得成功"]), answer: "A,B,C", analysis: "洋务运动于甲午战后破产，并非辛亥革命的背景。", qType: "multiple", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    // 判断（4）
    { id: 113, courseId: 1, kpIds: "3", title: "《南京条约》是中国近代史上第一个不平等条约。", options: JSON.stringify(["正确", "错误"]), answer: "正确", analysis: "《南京条约》是中国近代史上第一个不平等条约。", qType: "judge", difficulty: "easy", source: "manual", paperId: 301, createTime: T },
    { id: 114, courseId: 1, kpIds: "9", title: "甲午战争的失败标志着洋务运动的破产。", options: JSON.stringify(["正确", "错误"]), answer: "正确", analysis: "甲午战败、北洋水师覆没标志洋务运动破产。", qType: "judge", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 115, courseId: 1, kpIds: "12", title: "《中华民国临时约法》确立的是君主立宪制。", options: JSON.stringify(["正确", "错误"]), answer: "错误", analysis: "《临时约法》确立民主共和政体，采用三权分立。", qType: "judge", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 116, courseId: 1, kpIds: "1", title: "鸦片战争是中国近代史的开端。", options: JSON.stringify(["正确", "错误"]), answer: "正确", analysis: "鸦片战争是中国近代史的开端。", qType: "judge", difficulty: "easy", source: "manual", paperId: 301, createTime: T },
    // 填空（4）
    { id: 117, courseId: 1, kpIds: "2", title: "《南京条约》规定，中国向英国赔款____万银元。", options: "[]", answer: "2100", analysis: "赔款 2100 万银元，包括鸦片烟价、商款、军费。", qType: "cloze", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 118, courseId: 1, kpIds: "8", title: "洋务运动前期以「____」为口号创办军事工业，后期以「求富」为口号创办民用工业。", options: "[]", answer: "自强", analysis: "洋务运动前期口号为「自强」。", qType: "cloze", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 119, courseId: 1, kpIds: "11", title: "1911 年 10 月 10 日，____起义爆发，成为辛亥革命的首义。", options: "[]", answer: "武昌", analysis: "1911 年 10 月 10 日武昌起义爆发。", qType: "cloze", difficulty: "medium", source: "manual", paperId: 301, createTime: T },
    { id: 120, courseId: 1, kpIds: "12", title: "1912 年 3 月颁布的《____》，是中国历史上第一部资产阶级共和国宪法性文件。", options: "[]", answer: "中华民国临时约法", analysis: "《中华民国临时约法》是中国历史上第一部资产阶级共和国宪法性文件。", qType: "cloze", difficulty: "hard", source: "manual", paperId: 301, createTime: T },
  ],
  examPapers: [
    { id: 301, courseId: 1, name: "近代史结业模考", year: 0, createTime: T },
  ],
  flashCards: [
    { id: 201, courseId: 1, kpId: 1, front: "鸦片战争爆发的直接导火索是什么？", back: "林则徐虎门销烟；英国以此为借口于 1840 年发动战争。", source: "manual", createTime: T },
    { id: 202, courseId: 1, kpId: 2, front: "《南京条约》割让给英国的领土是哪里？", back: "香港岛。", source: "manual", createTime: T },
    { id: 203, courseId: 1, kpId: 3, front: "《南京条约》开放的五个通商口岸是哪些？", back: "广州、福州、厦门、宁波、上海。", source: "manual", createTime: T },
    { id: 204, courseId: 1, kpId: 4, front: "鸦片战争后中国经济结构出现的重大变化是什么？", back: "自然经济开始解体，被迫卷入资本主义世界市场。", source: "manual", createTime: T },
    { id: 205, courseId: 1, kpId: 7, front: "洋务运动兴起的背景是什么？", back: "内忧（太平天国）外患（列强侵略）双重压力，洋务派企图以西方技术维护统治。", source: "manual", createTime: T },
    { id: 206, courseId: 1, kpId: 8, front: "洋务运动前期与后期的口号分别是什么？", back: "前期「自强」（军事工业），后期「求富」（民用工业）。", source: "manual", createTime: T },
    { id: 207, courseId: 1, kpId: 9, front: "标志洋务运动破产的事件是什么？", back: "1895 年甲午战争北洋水师全军覆没，签订《马关条约》。", source: "manual", createTime: T },
    { id: 208, courseId: 1, kpId: 10, front: "辛亥革命爆发的主要背景有哪些？", back: "列强瓜分狂潮、清廷「预备立宪」失败、革命思想与组织广泛传播。", source: "manual", createTime: T },
    { id: 209, courseId: 1, kpId: 11, front: "辛亥革命的首义是哪次起义？时间、地点？", back: "武昌起义，1911 年 10 月 10 日，湖北武昌。", source: "manual", createTime: T },
    { id: 210, courseId: 1, kpId: 12, front: "《中华民国临时约法》确立的政体是什么？", back: "民主共和政体，规定三权分立。", source: "manual", createTime: T },
  ],
};
