import { describe, expect, it } from "vitest";
import eventsSchema from "../docs/contracts/events.schema.json";
import errorsDocument from "../docs/contracts/errors.json";
import { EVENT_TYPES, ERROR_CODES } from "../src/contracts";

function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

describe("contracts sync", () => {
  it("keeps EVENT_TYPES in sync with schema enum", () => {
    const schemaTypes = eventsSchema.$defs?.eventType?.enum ?? eventsSchema.properties.type.enum;

    expect(sortUnique([...EVENT_TYPES])).toEqual(sortUnique(schemaTypes));
  });

  it("keeps ERROR_CODES in sync with docs/contracts/errors.json", () => {
    const schemaErrorCodes = errorsDocument.errorCodes;

    expect(sortUnique([...ERROR_CODES])).toEqual(sortUnique(schemaErrorCodes));
  });
});
