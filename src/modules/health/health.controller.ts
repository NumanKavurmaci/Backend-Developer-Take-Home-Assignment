import type { Context } from "hono";
import { prisma } from "../../db/client.js";
import { assertDatabaseReady } from "../../db/readiness.js";
import { setRequestErrorCode } from "../../shared/http/request-observability.js";

type ReadinessCheck = () => Promise<void>;

async function defaultReadinessCheck(): Promise<void> {
  await assertDatabaseReady(prisma);
}

export class HealthController {
  constructor(
    private readonly readinessCheck: ReadinessCheck = defaultReadinessCheck,
  ) {}

  getHealth(c: Context) {
    return c.json({
      status: "ok",
      service: "saatcms-middleware-core",
    });
  }

  async getReadiness(c: Context) {
    try {
      await this.readinessCheck();

      return c.json({
        status: "ready",
        service: "saatcms-middleware-core",
      });
    } catch {
      setRequestErrorCode(c, "DATABASE_NOT_READY");

      return c.json(
        {
          status: "not_ready",
          service: "saatcms-middleware-core",
          errorCode: "DATABASE_NOT_READY",
          message: "Database is unreachable or its schema is not ready.",
        },
        503,
      );
    }
  }
}
