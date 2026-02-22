import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import vitestConfig, { TEMP_EXCLUDES } from "../../vitest.config";

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

describe("vitest TEMP exclude guard", () => {
  it("keeps TEMP excludes exact and extends configDefaults.exclude", () => {
    const configuredExclude = toStringArray(vitestConfig.test?.exclude);
    const tempExcludes = [...TEMP_EXCLUDES];

    expect(tempExcludes).toEqual([
      "**/tests/ui/scannerSimulatorV1.spec.ts",
      "**/tests/ui/scannerSimulatorV1.engineAdapter.spec.ts"
    ]);

    for (const tempExclude of tempExcludes) {
      expect(configuredExclude).toContain(tempExclude);
    }

    const scannerSpecificExcludes = configuredExclude.filter((entry) => {
      return entry.includes("scannerSimulatorV1")
        || (entry.includes("/src/ui/") && entry.endsWith(".spec.ts"));
    });

    expect(scannerSpecificExcludes.sort()).toEqual([...tempExcludes].sort());

    const firstDefaultExclude = configDefaults.exclude[0];
    expect(typeof firstDefaultExclude).toBe("string");
    expect(configuredExclude).toContain(firstDefaultExclude as string);
  });
});
