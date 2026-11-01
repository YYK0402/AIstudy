import { describe, it, expect } from "vitest";
import { CHANGELOG, changelogForHost, changelogSince, type ChangelogEntry } from "../changelog";

const sample: ChangelogEntry[] = [
  { version: "0.3.1", date: "2026-10-30", items: [{ text: "a" }] },
  { version: "0.3.0", date: "2026-10-30", items: [{ text: "b" }] },
  { version: "0.2.0", date: "2026-10-28", items: [{ text: "c" }] },
];

const hostSample: ChangelogEntry[] = [
  {
    version: "1.1.0",
    date: "2026-11-01",
    intro: "混合版本",
    items: [
      { text: "共用条目" },
      { hosts: ["siyuan"], head: "思源专属组", text: "思源专属条目" },
      { hosts: ["siyuan"], text: "思源专属组第二条" },
      { hosts: ["fnos"], text: "飞牛专属条目" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-01",
    items: [
      { hosts: ["fnos"], head: "飞牛专属组", text: "仅飞牛，整版本会被过滤掉" },
    ],
  },
];

describe("changelogSince", () => {
  it("返回高于 seen 的版本，保持新到旧顺序", () => {
    const got = changelogSince(sample, "0.3.0");
    expect(got.map((e) => e.version)).toEqual(["0.3.1"]);
  });

  it("seen 较早时返回多个", () => {
    expect(changelogSince(sample, "0.2.0").map((e) => e.version)).toEqual(["0.3.1", "0.3.0"]);
  });

  it("seen 为 null/空返回全部", () => {
    expect(changelogSince(sample, null).map((e) => e.version)).toEqual(["0.3.1", "0.3.0", "0.2.0"]);
    expect(changelogSince(sample, "").map((e) => e.version)).toEqual(["0.3.1", "0.3.0", "0.2.0"]);
  });

  it("seen 已是最新返回空", () => {
    expect(changelogSince(sample, "0.3.1")).toEqual([]);
  });

  it("seen 高于全部返回空", () => {
    expect(changelogSince(sample, "9.9.9")).toEqual([]);
  });
});

describe("changelogForHost", () => {
  it("siyuan 端：共用 + siyuan 专属，滤掉 fnos 专属与纯 fnos 版本", () => {
    const got = changelogForHost(hostSample, "siyuan");
    expect(got.map((e) => e.version)).toEqual(["1.1.0"]);
    expect(got[0].items.map((i) => i.text)).toEqual(["共用条目", "思源专属条目", "思源专属组第二条"]);
  });

  it("fnos 端：共用 + fnos 专属，滤掉 siyuan 专属与纯 siyuan 版本", () => {
    const got = changelogForHost(hostSample, "fnos");
    expect(got.map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(got[0].items.map((i) => i.text)).toEqual(["共用条目", "飞牛专属条目"]);
    expect(got[1].items[0].head).toBe("飞牛专属组");
  });

  it("组首条被滤掉时，组标题跟随组内第一条保留条目", () => {
    const entries: ChangelogEntry[] = [
      {
        version: "2.0.0",
        date: "2026-11-02",
        items: [
          { hosts: ["fnos"], head: "混合组", text: "仅飞牛" },
          { text: "组内共用条目" },
        ],
      },
    ];
    const got = changelogForHost(entries, "siyuan");
    expect(got[0].items).toEqual([{ text: "组内共用条目", head: "混合组" }]);
  });

  it("host 未声明 / 空 → 不过滤返回全部", () => {
    expect(changelogForHost(hostSample, null).map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(changelogForHost(hostSample, undefined).map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
  });
});

describe("CHANGELOG 数据形状", () => {
  it("非空且最新在前（0.4.4）", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0].version).toBe("0.4.4");
  });

  it("每条都有非空 version/date 与 items", () => {
    for (const e of CHANGELOG) {
      expect(e.version.length).toBeGreaterThan(0);
      expect(e.date.length).toBeGreaterThan(0);
      expect(Array.isArray(e.items)).toBe(true);
      expect(e.items.length).toBeGreaterThan(0);
      for (const it of e.items) expect(it.text.length).toBeGreaterThan(0);
    }
  });

  it("版本严格新到旧", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(changelogSince(CHANGELOG, CHANGELOG[i].version).some((e) => e.version === CHANGELOG[i - 1].version)).toBe(true);
    }
  });

  it("各端过滤结果非空，且最新版本在其目标端可见（防止某端被标空）", () => {
    const s = changelogForHost(CHANGELOG, "siyuan");
    const f = changelogForHost(CHANGELOG, "fnos");
    expect(s.length).toBeGreaterThan(0);
    expect(f.length).toBeGreaterThan(0);
    expect(s[0].version).toBe(CHANGELOG[0].version);
    // 0.4.4 为思源端专属修复，fnos 最新可见版本为 0.4.3
    expect(f[0].version).toBe("0.4.3");
  });
});

describe("跨端信息隔离（任一端不得感知其他端的存在）", () => {
  const renderText = (host: "siyuan" | "fnos") =>
    changelogForHost(CHANGELOG, host)
      .map((e) => [e.intro, ...e.items.map((i) => (i.head ? `${i.head} ${i.text}` : i.text))].join("\n"))
      .join("\n");

  it("fnos 端全文不含思源端标识（思源 / 3.8.9 / bazaar）", () => {
    const text = renderText("fnos");
    for (const token of ["思源", "3.8.9", "bazaar"]) {
      expect(text).not.toContain(token);
    }
  });

  it("siyuan 端全文不含飞牛端标识（飞牛 / fnOS）", () => {
    const text = renderText("siyuan");
    for (const token of ["飞牛", "fnOS", "fnos"]) {
      expect(text).not.toContain(token);
    }
  });

  it("任一端不出现多端改造痕迹（「按端」字样）", () => {
    for (const host of ["siyuan", "fnos"] as const) {
      expect(renderText(host)).not.toContain("按端");
    }
  });

  it("fnos 端：0.4.1（思源移动端）整版本隐藏", () => {
    expect(changelogForHost(CHANGELOG, "fnos").map((e) => e.version)).not.toContain("0.4.1");
  });

  it("intro 按端渲染：0.4.3 / 0.3.0 / 0.1.0", () => {
    const byHost = (host: "siyuan" | "fnos", version: string) =>
      changelogForHost(CHANGELOG, host).find((e) => e.version === version)?.intro;
    expect(byHost("siyuan", "0.4.3")).toContain("加载失败可见提示");
    expect(byHost("fnos", "0.4.3")).toBe("侧栏 logo 更新");
    expect(byHost("fnos", "0.3.0")).not.toContain("3.8.9");
    expect(byHost("siyuan", "0.1.0")).toContain("思源自学课程插件");
    expect(byHost("fnos", "0.1.0")).not.toContain("思源");
  });
});
