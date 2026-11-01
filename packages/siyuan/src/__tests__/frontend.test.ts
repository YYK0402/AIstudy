import { describe, expect, it } from "vitest";
import { isMobileFrontend } from "../frontend";

describe("isMobileFrontend", () => {
  it("移动端取值识别为移动", () => {
    expect(isMobileFrontend("mobile")).toBe(true);
    expect(isMobileFrontend("browser-mobile")).toBe(true);
  });

  it("桌面取值识别为桌面", () => {
    expect(isMobileFrontend("desktop")).toBe(false);
    expect(isMobileFrontend("desktop-window")).toBe(false);
    expect(isMobileFrontend("browser-desktop")).toBe(false);
  });
});
