import { defineEventHandler } from "h3";

export default defineEventHandler(() => {
  return { ok: true, app: process.env.APP_NAME || "ai-study" };
});
