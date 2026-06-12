import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Logger } from "@william/core";
import type { VercelAdapter } from "../types";
import { callJson, failure, requireTicket, simulatedReal, type RealDeps } from "./shared";

const API = "https://api.vercel.com";

export function createVercelAdapter(deps: RealDeps, log: Logger): VercelAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const teamQuery = deps.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(deps.env.VERCEL_TEAM_ID)}` : "";
  const call = (method: string, path: string, body?: Record<string, unknown>) =>
    callJson(fetchImpl, `${API}${path}${teamQuery}`, {
      method,
      headers: {
        authorization: `Bearer ${deps.env.VERCEL_TOKEN}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  return {
    name: "vercel",

    async deploy(ticket, input) {
      requireTicket(ticket, "vercel.deploy");
      if (ticket.dryRun) {
        return simulatedReal("vercel", "deploy", `${input.target} ${input.projectName} from ${input.sourcePath}`, "dpl");
      }
      let files: { file: string; data: string }[];
      try {
        // Preview artifacts are single-file static HTML today; a directory
        // source uploads its index.html. Phase D (react builds) replaces this
        // with a git-connected deploy.
        const path = statSync(input.sourcePath).isDirectory()
          ? join(input.sourcePath, "index.html")
          : input.sourcePath;
        files = [{ file: basename(path), data: readFileSync(path, "utf8") }];
      } catch (err) {
        return { dryRun: false, ok: false, detail: `vercel.deploy: cannot read ${input.sourcePath}: ${err instanceof Error ? err.message : err}` };
      }
      const res = await call("POST", "/v13/deployments", {
        name: input.projectName,
        project: input.projectName,
        files,
        ...(input.target === "production" ? { target: "production" } : {}),
      });
      if (!res.ok) return failure("vercel.deploy", res.status, res.text);
      log.info("vercel deployment created", { id: res.body.id, target: input.target, traceId: ticket.traceId });
      return {
        dryRun: false,
        ok: true,
        externalId: String(res.body.id),
        url: `https://${String(res.body.url)}`,
        detail: `Vercel ${input.target} deployment of ${input.projectName}`,
      };
    },

    async rollback(ticket, deploymentExternalId) {
      requireTicket(ticket, "vercel.rollback");
      if (ticket.dryRun) {
        return simulatedReal("vercel", "rollback", deploymentExternalId, "dpl");
      }
      const dep = await call("GET", `/v13/deployments/${encodeURIComponent(deploymentExternalId)}`);
      if (!dep.ok) return failure("vercel.rollback (lookup)", dep.status, dep.text);
      const projectId = String(dep.body.projectId ?? "");
      const res = await call(
        "POST",
        `/v9/projects/${encodeURIComponent(projectId)}/rollback/${encodeURIComponent(deploymentExternalId)}`,
      );
      if (!res.ok) return failure("vercel.rollback", res.status, res.text);
      return { dryRun: false, ok: true, externalId: deploymentExternalId, detail: `Rolled project ${projectId} back to ${deploymentExternalId}` };
    },
  };
}
