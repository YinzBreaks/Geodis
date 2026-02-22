import eventsSchemaDocument from "../../docs/contracts/events.schema.json" assert { type: "json" };
const CANONICAL_EVENT_TYPES = [
    "RF_LOGIN",
    "RF_MENU_SELECT",
    "RF_KEY_CTRL_T",
    "RF_TASK_GROUP_SET",
    "RF_ZONE_SELECTED",
    "SCAN_CART_LABEL",
    "SCAN_TOTE_ASSIGN",
    "RF_KEY_CTRL_E",
    "PICK_ASSIGN",
    "ARRIVE_LOCATION",
    "SCAN_ITEM",
    "ENTER_QUANTITY",
    "SCAN_TOTE_VERIFY",
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
    "STEP_ACCEPTED",
    "STEP_REJECTED",
    "ERROR"
];
function ensureCanonicalEventTypes() {
    const enumValues = resolveEventTypeEnumValues();
    const expected = [...CANONICAL_EVENT_TYPES];
    if (enumValues.length !== expected.length
        || enumValues.some((value) => !expected.includes(value))) {
        throw new Error("docs/contracts/events.schema.json no longer matches canonical event type list in src/contracts/events.ts");
    }
    return Object.freeze([...enumValues]);
}
function resolveEventTypeEnumValues() {
    const typeNode = eventsSchemaDocument.properties?.type;
    const inlineEnum = typeNode?.enum;
    if (Array.isArray(inlineEnum)) {
        return inlineEnum;
    }
    const defsEnum = eventsSchemaDocument.$defs?.eventType?.enum;
    if (Array.isArray(defsEnum)) {
        return defsEnum;
    }
    throw new Error("docs/contracts/events.schema.json is missing canonical event type enum; checked properties.type.enum and $defs.eventType.enum");
}
export const EVENT_TYPES = ensureCanonicalEventTypes();
function deepFreeze(value) {
    if (value === null || typeof value !== "object") {
        return value;
    }
    const objectValue = value;
    for (const key of Object.keys(objectValue)) {
        deepFreeze(objectValue[key]);
    }
    return Object.freeze(value);
}
export function createEvent(event) {
    const { eventId, timestamp, type, traineeId, sessionId, payload, cartSessionId, cartId, roundNumber, pickTaskId } = event;
    const base = {
        eventId,
        timestamp,
        type,
        traineeId,
        sessionId,
        payload: deepFreeze({ ...payload })
    };
    if (cartSessionId !== undefined) {
        base.cartSessionId = cartSessionId;
    }
    if (cartId !== undefined) {
        base.cartId = cartId;
    }
    if (roundNumber !== undefined) {
        base.roundNumber = roundNumber;
    }
    if (pickTaskId !== undefined) {
        base.pickTaskId = pickTaskId;
    }
    return deepFreeze(base);
}
