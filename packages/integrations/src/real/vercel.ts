import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Logger } from "@william/core";
import type { VercelAdapter } from "../types";
import { callJson, failure, requireTicket, simulatedReal, type RealDeps } from "./shared";

const API = "https://api.vercel.com";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vercel"]);
const MAX_FILES = 200;

/**
 * Walks a build directory into Vercel's inline-file shape (posix-relative
 * paths). Hardened: dotfiles (e.g. a stray .env) and symlinks are never
 * uploaded, and exceeding MAX_FILES throws rather than silently deploying a
 * partial site.
 */
function collectFiles(root: string, prefix = "", out: { file: string; data: string }[] = []): { file: string; data: string }[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectFiles(join(root, entry.name), rel, out);
    } else {
      if (out.length >= MAX_FILES) throw new Error(`vercel.deploy: more than ${MAX_FILES} files in ${root} — refusing partial upload`);
      out.push({ file: rel, data: readFileSync(join(root, entry.name), "utf8") });
    }
  }
  return out;
}

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
        // Directory sources (static preview dir or a generated React project)
        // upload all files inline; single files upload as-is.
        files = statSync(input.sourcePath).isDirectory()
          ? collectFiles(input.sourcePath)
          : [{ file: basename(input.sourcePath), data: readFileSync(input.sourcePath, "utf8") }];
      } catch (err) {
        return { dryRun: false, ok: false, detail: `vercel.deploy: cannot read ${input.sourcePath}: ${err instanceof Error ? err.message : err}` };
      }
      if (files.length === 0) {
        return { dryRun: false, ok: false, detail: `vercel.deploy: ${input.sourcePath} has no uploadable files` };
      }
      const hasPackageJson = files.some((f) => f.file === "package.json");
      const res = await call("POST", "/v13/deployments", {
        name: input.projectName,
        project: input.projectName,
        files,
        // Generated React projects are Vite apps Vercel must build.
        // TODO(phase-e): verify framework detection against Vercel docs with a live token.
        ...(hasPackageJson ? { projectSettings: { framework: "vite" } } : {}),
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
