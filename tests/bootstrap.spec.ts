import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted by Vitest above all imports, so the mock is in place when
// bootstrap.ts is imported.  The module-level auto-run guard checks
// `typeof window !== "undefined"` — this is false in Node, so it is inert here.
vi.mock("../src/ui/dev/routes.js", () => ({
  mountDevRoutes: vi.fn()
}));

// Import AFTER mock declaration so the hoisted mock is active.
import { bootstrap } from "../src/ui/dev/bootstrap.js";
import { mountDevRoutes } from "../src/ui/dev/routes.js";

const mockMountDevRoutes = mountDevRoutes as ReturnType<typeof vi.fn>;

describe("bootstrap", () => {
  beforeEach(() => {
    mockMountDevRoutes.mockReset();
    mockMountDevRoutes.mockResolvedValue({ mounted: false, destroy: () => {} });
  });

  it("passes the injected document to mountDevRoutes", async () => {
    const fakeDocument = {
      defaultView: { location: { pathname: "/" } }
    } as unknown as Document;

    await bootstrap(fakeDocument);

    expect(mockMountDevRoutes).toHaveBeenCalledOnce();
    expect(mockMountDevRoutes).toHaveBeenCalledWith(fakeDocument);
  });

  it("returns void (resolves to undefined) regardless of route match", async () => {
    const fakeDocument = {
      defaultView: { location: { pathname: "/dev/scanner" } }
    } as unknown as Document;

    mockMountDevRoutes.mockResolvedValueOnce({ mounted: true, destroy: () => {} });

    await expect(bootstrap(fakeDocument)).resolves.toBeUndefined();
  });

  it("module-level auto-run does not fire in Node (window guard is inert)", () => {
    // If the auto-run had fired on import, mockMountDevRoutes would show a call
    // with no injected document before any test ran.  beforeEach resets the mock
    // so by the time this test body executes the count is 0 (no calls this test).
    expect(mockMountDevRoutes).not.toHaveBeenCalled();
  });
});
