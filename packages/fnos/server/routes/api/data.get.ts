import { defineEventHandler } from "h3";
import { getGatewayUser } from "../../utils/gateway-user";
import { loadUserData } from "../../utils/user-data";

export default defineEventHandler((event) => {
  const user = getGatewayUser(event);
  return loadUserData(user.uid);
});
