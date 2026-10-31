import { defineEventHandler, readValidatedBody } from "h3";
import { listModels } from "../../../utils/ai-engine";
import { getGatewayUser } from "../../../utils/gateway-user";

export default defineEventHandler(async (event) => {
  const user = getGatewayUser(event);
  const body = await readValidatedBody(event, (d) => d) as { providerId?: number };
  if (!Number.isInteger(body?.providerId)) {
    throw new HTTPError({ status: 400, message: "providerId 非法" });
  }
  return await listModels(user.uid, body.providerId);
});
