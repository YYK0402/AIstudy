import { describe, expect, it } from "vitest";
import { sortSlideNames } from "../documentParser";

describe("sortSlideNames（U3：pptx 页码数值排序）", () => {
  it("slide10 排在 slide2 之后（数值序而非字典序）", () => {
    expect(sortSlideNames(["ppt/slides/slide10.xml", "ppt/slides/slide2.xml", "ppt/slides/slide1.xml"])).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide10.xml",
    ]);
  });

  it("过滤非 slides 下的同名文件", () => {
    expect(sortSlideNames(["ppt/notesSlides/notesSlide1.xml", "ppt/slides/slide3.xml", "ppt/slides/slide1.xml"])).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide3.xml",
    ]);
  });
});
