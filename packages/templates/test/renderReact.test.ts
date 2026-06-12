import { describe, expect, it } from "vitest";
import { TEMPLATES, getTemplateById, renderReactProject } from "../src";
import type { CompanyData } from "../src";

const template = TEMPLATES[0]!;
const data: CompanyData = {
  name: "Fade Lab",
  niche: "barbershop",
  tagline: "Sharp cuts.",
  phone: "(607) 555-0101",
  email: "hi@fadelab.example",
  services: ["Haircuts", "Beard Trims"],
  trustSignals: ['Best of Ithaca "2025"'],
};

describe("renderReactProject", () => {
  it("emits a complete Vite + React + Framer Motion project", () => {
    const files = renderReactProject(template, data);
    const byName = Object.fromEntries(files.map((f) => [f.file, f.data]));
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining(["package.json", "vite.config.ts", "index.html", "src/main.tsx", "src/App.tsx", "src/styles.css"]),
    );
    const pkg = JSON.parse(byName["package.json"]!) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["framer-motion"]).toBeDefined();
    expect(pkg.dependencies.react).toBeDefined();
    expect(byName["src/App.tsx"]).toContain("useReducedMotion");
    expect(byName["src/App.tsx"]).toContain("Fade Lab");
    expect(byName["src/styles.css"]).toContain(template.theme.accent);
  });

  it("embeds company data as JSON in App.tsx and HTML-escapes it in index.html", () => {
    const hostile: CompanyData = { ...data, name: 'Bad`}{" <script>alert(1)</script>', tagline: "${process.env}" };
    const files = renderReactProject(template, hostile);
    const app = files.find((f) => f.file === "src/App.tsx")!.data;
    // Hostile strings stay inside JSON string literals (React renders them as text).
    expect(app).toContain(JSON.stringify(hostile.name));
    expect(app).toContain(JSON.stringify(hostile.tagline));
    const html = files.find((f) => f.file === "index.html")!.data;
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("getTemplateById round-trips registry templates", () => {
    expect(getTemplateById(template.id)?.id).toBe(template.id);
    expect(getTemplateById("nope")).toBeNull();
  });
});
