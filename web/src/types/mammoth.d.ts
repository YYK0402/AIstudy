// mammoth 浏览器版本的 TypeScript 声明
declare module "mammoth/mammoth.browser" {
  interface ExtractResult {
    value: string;
    messages: Array<{ type: string; message: string }>;
  }
  interface MammothStatic {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<ExtractResult>;
  }
  const mammoth: MammothStatic;
  export default mammoth;
}