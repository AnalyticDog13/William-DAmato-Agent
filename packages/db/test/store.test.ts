import { describe, expect, it } from "vitest";
import { newId, nowIso, type Lead } from "@william/core";
import { openMemoryDatabase, Store } from "../src/index";

function makeLead(overrides: Partial<Lead> = {}): Lead {
  const now = nowIso();
  return {
    id: newId("lead"),
    createdAt: now,
    updatedAt: now,
    companyId: newId("com"),
    domain: "example.com",
    websiteUrl: "https://example.com",
    niche: "barbershop",
    status: "new",
    source: { kind: "manual", detail: "test", importedAt: now, importedBy: "owner" },
    identityKeys: ["domain:example.com"],
    notes: "",
    disqualifiedReason: null,
    ...overrides,
  };
}

describe("Store repositories", () => {
  it("round-trips and validates entities", () => {
    const store = new Store(openMemoryDatabase());
    const lead = store.leads.insert(makeLead());
    expect(store.leads.get(lead.id)?.domain).toBe("example.com");
    expect(store.leads.list({ status: "new" })).toHaveLength(1);
    expect(store.leads.findByKey("domain:example.com")).toHaveLength(1);
    expect(store.leads.findByKey("domain:other.com")).toHaveLength(0);
  });

  it("rejects invalid entities at the boundary", () => {
    const store = new Store(openMemoryDatabase());
    expect(() => store.leads.insert(makeLead({ status: "bogus" as never }))).toThrow();
  });

  it("search filters by JSON substring", () => {
    const store = new Store(openMemoryDatabase());
    store.leads.insert(makeLead({ notes: "needs espresso machine page" }));
    store.leads.insert(makeLead({ domain: "other.com", identityKeys: ["domain:other.com"] }));
    expect(store.leads.list({ search: "espresso" })).toHaveLength(1);
  });

  it("round-trips weekly reports keyed by weekStart", () => {
    const store = new Store(openMemoryDatabase());
    const now = nowIso();
    store.weeklyReports.insert({
      id: newId("wrep"),
      createdAt: now,
      updatedAt: now,
      weekStart: "2026-06-08",
      weekEnd: "2026-06-14",
      summary: "First full week",
      metrics: { leadsTotal: 3 },
      wins: ["1 positive reply"],
      bottlenecks: [],
      lessons: [],
      experimentFindings: [],
      reportText: "# Weekly",
    });
    expect(store.weeklyReports.list({ skey: "2026-06-08" })).toHaveLength(1);
    expect(store.weeklyReports.list({ skey: "2026-06-01" })).toHaveLength(0);
    expect(() =>
      store.weeklyReports.insert({
        id: newId("wrep"),
        createdAt: now,
        updatedAt: now,
        weekStart: "not-a-date",
        weekEnd: "2026-06-14",
        summary: "",
        metrics: {},
        wins: [],
        bottlenecks: [],
        lessons: [],
        experimentFindings: [],
        reportText: "",
      }),
    ).toThrow();
  });

  it("accepts the design lesson topic (transcript ingestion target)", () => {
    const store = new Store(openMemoryDatabase());
    const now = nowIso();
    const lesson = store.lessons.insert({
      id: newId("les"),
      createdAt: now,
      updatedAt: now,
      topic: "design",
      lesson: "Hero sections convert better with a single CTA",
      evidence: ["transcript:design-review.txt"],
      confidence: 0.5,
      timesConfirmed: 1,
      supersededBy: null,
    });
    expect(store.lessons.get(lesson.id)?.topic).toBe("design");
  });

  it("gate policies default to approval mode", () => {
    const store = new Store(openMemoryDatabase());
    expect(store.getGatePolicy("SEND_FIRST_TOUCH").mode).toBe("approval");
    store.setGatePolicy("SEND_FIRST_TOUCH", "closed", "owner turned it off");
    expect(store.getGatePolicy("SEND_FIRST_TOUCH").mode).toBe("closed");
  });
});

describe("JobQueue", () => {
  it("enqueues, claims, completes", () => {
    const store = new Store(openMemoryDatabase());
    const job = store.queue.enqueue({ type: "lead.audit", payload: { x: 1 }, traceId: "trc_1" });
    const claimed = store.queue.claimNext();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    expect(store.queue.claimNext()).toBeNull(); // nothing else runnable
    store.queue.complete(job.id);
    expect(store.queue.list({ status: "succeeded" })).toHaveLength(1);
  });

  it("does not claim delayed jobs before runAt", () => {
    const store = new Store(openMemoryDatabase());
    store.queue.enqueue({ type: "t", payload: {}, traceId: "trc", delayMs: 60_000 });
    expect(store.queue.claimNext()).toBeNull();
    expect(store.queue.claimNext(new Date(Date.now() + 61_000))).not.toBeNull();
  });

  it("retries with backoff then dead-letters after maxAttempts", () => {
    const store = new Store(openMemoryDatabase());
    const job = store.queue.enqueue({ type: "t", payload: {}, traceId: "trc", maxAttempts: 2 });

    let claimed = store.queue.claimNext();
    expect(claimed?.attempts).toBe(1);
    expect(store.queue.fail(job.id, "boom")).toBe("retried");

    claimed = store.queue.claimNext(new Date(Date.now() + 10 * 60_000));
    expect(claimed?.attempts).toBe(2);
    expect(store.queue.fail(job.id, "boom again")).toBe("dead");
    expect(store.queue.list({ status: "dead" })).toHaveLength(1);
  });
});
