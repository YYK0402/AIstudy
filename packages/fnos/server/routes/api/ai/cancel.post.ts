import { defineEventHandler, readValidatedBody } from "h3";
import { cancelAiCall } from "../../../utils/ai-engine";
import { getGatewayUser } from "../../../utils/gateway-user";

export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const body = await readValidatedBody(event, (d) => d) as { taskKey?: string; scope?: string };
  if (typeof body?.taskKey === "string" && body.taskKey) {
    cancelAiCall(user.uid, body.taskKey, body.scope);
  }
  return { ok: true };
});
