import { createContext, ensureBootstrapOwnerRequests } from "@william/worker-orchestrator";
import { createServer } from "./server";

const ctx = createContext();
ensureBootstrapOwnerRequests(ctx);
const app = createServer(ctx);
app.listen(ctx.config.apiPort, () => {
  ctx.log.info("api listening", {
    port: ctx.config.apiPort,
    env: ctx.config.env,
    dryRun: ctx.config.dryRun,
    dashboardOrigin: ctx.config.dashboardOrigin,
  });
});
