import { describe, expect, it } from "vitest";
import type { AppData, AiProvider } from "../../types/appData";
import { createEmptyData } from "../../../../src/data";

const seedProvider: AiProvider = {
  id: 1,
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
  timeout: 60,
  enabled: true,
  createTime: "2026-10-01T00:00:00Z",
};

const dataRef: { data: AppData } = {
  data: { ...createEmptyData(), providers: [seedProvider] },
};
(globalThis as Record<string, unknown>).window = {
  addEventListener: () => {},
  dispatchEvent: () => true,
  siyuanAiStudy: {
    getData: async () => dataRef.data,
    saveData: async (next: AppData) => {
      dataRef.data = next;
      return { code: 0 };
    },
  },
};

const { createProvider, updateProvider } = await import("../provider");

describe("createProvider 入参校验", () => {
  it("名称为空 → 抛错且不写盘", async () => {
    await expect(createProvider({ name: "  ", baseUrl: "https://api.openai.com/v1", apiKey: "sk-x" })).rejects.toThrow(
      "服务商名称不能为空",
    );
    expect(dataRef.data.providers).toHaveLength(1);
  });

  it("baseUrl 非 URL → 抛错且不写盘", async () => {
    await expect(createProvider({ name: "X", baseUrl: "not a url", apiKey: "sk-x" })).rejects.toThrow("接口地址格式不正确");
    expect(dataRef.data.providers).toHaveLength(1);
  });

  it("baseUrl 非 http/https → 抛错", async () => {
    await expect(createProvider({ name: "X", baseUrl: "ftp://x/v1", apiKey: "sk-x" })).rejects.toThrow("仅支持 http/https");
    expect(dataRef.data.providers).toHaveLength(1);
  });

  it("合法入参 → 正常创建", async () => {
    const p = await createProvider({ name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiKey: "sk-y" });
    expect(p.name).toBe("DeepSeek");
    expect(p.enabled).toBe(true);
    expect(dataRef.data.providers).toHaveLength(2);
  });
});

describe("updateProvider", () => {
  it("id 不存在 → 抛错（不再静默 no-op）", async () => {
    await expect(
      updateProvider({ ...seedProvider, id: 999, name: "Ghost" }),
    ).rejects.toThrow("服务商不存在");
    expect(dataRef.data.providers.find((p) => p.id === 1)?.name).toBe("OpenAI");
  });

  it("合法更新 → 替换并写盘", async () => {
    await updateProvider({ ...seedProvider, name: "OpenAI 改名" });
    expect(dataRef.data.providers.find((p) => p.id === 1)?.name).toBe("OpenAI 改名");
  });
});
