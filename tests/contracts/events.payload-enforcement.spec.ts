import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import eventsSchemaDocument from "../../docs/contracts/events.schema.json" assert { type: "json" };

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(eventsSchemaDocument);

type EventType = (typeof eventsSchemaDocument.$defs.eventType.enum)[number];

function makeEvent(type: EventType, payload: Record<string, unknown>) {
  return {
    eventId: "ev-contract-test",
    timestamp: "2026-02-18T12:00:00.000Z",
    type,
    traineeId: "t1",
    sessionId: "s1",
    payload
  };
}

describe("events payload contract enforcement", () => {
  it.each([
    "RF_LOGIN",
    "RF_KEY_CTRL_T",
    "RF_TASK_GROUP_SET",
    "RF_KEY_CTRL_E",
    "PICK_ASSIGN",
    "ARRIVE_LOCATION",
    "RF_END_OF_TOTE_SHOWN",
    "RF_KEY_CTRL_A",
    "TOTE_PLACED_ON_CONVEYOR",
    "RF_KEY_CTRL_W",
    "RF_KEY_CTRL_K",
    "EXCEPTION_TOTE_ALLOCATED",
    "EXCEPTION_CART_ALREADY_CREATED",
    "EXCEPTION_INCORRECT_LOCATION",
    "EXCEPTION_INCORRECT_TOTE",
    "EXCEPTION_INVALID_ITEM_LAST",
    "EXCEPTION_INVALID_ITEM_NOT_LAST",
    "EXCEPTION_SHORT_INVENTORY",
    "EXCEPTION_DAMAGED_ITEM",
    "STEP_ACCEPTED"
  ] as const)("rejects keyed payload for payload-free event %s", (type) => {
    const ok = validate(makeEvent(type, { unexpected: "x" }));

    expect(ok).toBe(false);
  });

  it.each([
    { type: "RF_MENU_SELECT", valid: { value: "1" }, missingRequired: {}, extra: { value: "1", extra: true } },
    {
      type: "RF_ZONE_SELECTED",
      valid: { zoneOrTaskGroupCode: "ZONE-A" },
      missingRequired: {},
      extra: { zoneOrTaskGroupCode: "ZONE-A", extra: true }
    },
    { type: "SCAN_CART_LABEL", valid: { barcode: "CART-001" }, missingRequired: {}, extra: { barcode: "CART-001", extra: true } },
    {
      type: "SCAN_TOTE_ASSIGN",
      valid: { barcode: "TOTE-001", slotIndex: 1 },
      missingRequired: { barcode: "TOTE-001" },
      extra: { barcode: "TOTE-001", slotIndex: 1, extra: true }
    },
    { type: "SCAN_ITEM", valid: { barcode: "ITEM-001" }, missingRequired: {}, extra: { barcode: "ITEM-001", extra: true } },
    { type: "ENTER_QUANTITY", valid: { quantity: 1 }, missingRequired: {}, extra: { quantity: 1, extra: true } },
    {
      type: "SCAN_TOTE_VERIFY",
      valid: { barcode: "TOTE-001" },
      missingRequired: {},
      extra: { barcode: "TOTE-001", extra: true }
    },
    {
      type: "STEP_REJECTED",
      valid: { errorCode: "ERR_SEQUENCE_QTY_MISSING" },
      missingRequired: {},
      extra: { errorCode: "ERR_SEQUENCE_QTY_MISSING", extra: true }
    },
    {
      type: "ERROR",
      valid: { errorCode: "ERR_SEQUENCE_QTY_MISSING" },
      missingRequired: {},
      extra: { errorCode: "ERR_SEQUENCE_QTY_MISSING", extra: true }
    }
  ] as const)("rejects missing required and extra fields for payload-shaped event %s", ({ type, valid, missingRequired, extra }) => {
    expect(validate(makeEvent(type, valid))).toBe(true);
    expect(validate(makeEvent(type, missingRequired))).toBe(false);
    expect(validate(makeEvent(type, extra))).toBe(false);
  });

  it("accepts valid STEP_REJECTED.rejectedType and rejects invalid rejectedType", () => {
    const valid = makeEvent("STEP_REJECTED", {
      errorCode: "ERR_SEQUENCE_QTY_MISSING",
      rejectedType: "SCAN_ITEM"
    });
    const invalid = makeEvent("STEP_REJECTED", {
      errorCode: "ERR_SEQUENCE_QTY_MISSING",
      rejectedType: "NOT_A_CANONICAL_EVENT"
    });

    expect(validate(valid)).toBe(true);
    expect(validate(invalid)).toBe(false);
  });
});
