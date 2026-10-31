import { HTTPError, defineEventHandler, readValidatedBody } from "h3";
import type { CallAiMessage } from "../../../../core/src/bridge/types";
import { callAi, type AiCallInput } from "../../utils/ai-engine";
import { getGatewayUser } from "../../utils/gateway-user";

export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const body = await readValidatedBody(event, (d) => d) as AiCallInput;
  if (!body?.providerId || !body.modelId || !Array.isArray(body.messages) || !body.taskKey) {
    throw new HTTPError({ status: 400, message: "参数不完整" });
  }
  for (const m of body.messages) {
    if (!m || typeof m.role !== "string" || typeof m.content !== "string") {
      throw new HTTPError({ status: 400, message: "消息格式非法" });
    }
  }
  try {
    return await callAi(user.uid, body as { providerId: number; modelId: string; messages: CallAiMessage[]; taskKey: string; scope?: string });
  } catch (e) {
    throw new HTTPError({ status: 502, message: e instanceof Error ? e.message : String(e) });
  }
});
