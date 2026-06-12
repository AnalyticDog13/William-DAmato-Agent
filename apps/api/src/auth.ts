import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { AppContext } from "@william/worker-orchestrator";

export const DEV_OWNER_TOKEN = "dev-owner-token";

export function resolveOwnerToken(ctx: AppContext): string {
  if (ctx.config.ownerApiToken) return ctx.config.ownerApiToken;
  if (ctx.config.env === "local") {
    ctx.log.warn(
      "OWNER_API_TOKEN not set — using the well-known dev token. Fine for local; NEVER for staging/production.",
    );
    return DEV_OWNER_TOKEN;
  }
  throw new Error("OWNER_API_TOKEN is required outside local environment.");
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Owner bearer-token auth, enforced server-side on every /api route.
 * RBAC note: single role today ("owner"); requests carry req.role so a
 * "viewer" role can be added without route rewrites.
 */
export function requireOwner(token: string) {
  return (req: Request & { role?: string }, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!given || !tokensMatch(given, token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.role = "owner";
    next();
  };
}
