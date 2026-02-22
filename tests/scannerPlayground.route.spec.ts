import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mountDevRoutes } from "../src/ui/dev/routes.js";

describe("dev scanner route smoke", () => {
  it("imports and returns destroy() handle without throwing", async () => {
    const fakeDocument = {
      defaultView: {
        location: {
          pathname: "/"
        }
      }
    } as unknown as Document;

    const handle = await mountDevRoutes(fakeDocument);

    expect(handle.mounted).toBe(false);
    expect(typeof handle.destroy).toBe("function");
    expect(() => handle.destroy()).not.toThrow();
  });
});

describe("scannerPlayground UI/engine boundary guard", () => {
  // Read source once at collection time — this is a static contract test, not a
  // runtime test, so no jsdom or adapter execution is needed.
  const playgroundSrc = readFileSync(
    join(process.cwd(), "src/ui/dev/scannerPlayground.ts"),
    "utf8"
  );

  it("does not contain a SCAN_ITEM string literal (engine mapping must stay in adapter)", () => {
    expect(playgroundSrc).not.toContain('"SCAN_ITEM"');
    expect(playgroundSrc).not.toContain("'SCAN_ITEM'");
  });

  it("does not import EventType from contracts for mapping logic", () => {
    // EventType must not appear in an import from the contracts module
    expect(playgroundSrc).not.toMatch(/import\s+[\s\S]*?EventType[\s\S]*?from\s+['"].*contracts/);
  });
  it("uses the canonical validateFixtureManifest from contracts (no drifting local assert)", () => {
    expect(playgroundSrc).toContain("validateFixtureManifest");
    // Must import it from the contracts layer, not define it locally
    expect(playgroundSrc).toMatch(/import\s+[\s\S]*?validateFixtureManifest[\s\S]*?from\s+['"]\..*contracts/);
  });});
