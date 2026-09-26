import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ["SUPABASE_SERVICE_ROLE_KEY", "MANUAL_RUN_TOKEN", "headers.authorization"],
});
