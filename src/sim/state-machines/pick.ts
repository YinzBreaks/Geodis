import { createEvent, type AnyEvent, type BaseEvent, type ErrorCode } from "../../contracts";
import { emitMany } from "../emit";
import type { EmittedResult } from "../types";

// SSoT: docs/Workflows/pick.md (WI 5.2)
export type PickStatus =
  | "PK_IDLE"
  | "PK_LOGGED_IN"
  | "PK_PROGRAM_SELECTED"
  | "PK_PHASE_SELECTED"
  | "PK_TASK_ACTIVE"
  | "PK_AT_LOCATION"
  | "PK_ITEM_SCANNED"
  | "PK_QTY_ENTERED"
  | "PK_TOTE_VERIFIED"
  | "PK_END_OF_TOTE_PENDING"
  | "PK_TOTE_CONFIRMED"
  | "PK_TOTE_CONVEYED";

export type PickState = {
  status: PickStatus;
};

export function createPickInitialState(): PickState {
  return { status: "PK_IDLE" };
}

function accepted(action: AnyEvent): BaseEvent<"STEP_ACCEPTED"> {
  return createEvent({
    eventId: `${action.eventId}:accepted`,
    timestamp: action.timestamp,
    type: "STEP_ACCEPTED",
    traineeId: action.traineeId,
    sessionId: action.sessionId,
    payload: {}
  });
}

function rejected(action: AnyEvent, code: ErrorCode, details?: Record<string, unknown>): readonly AnyEvent[] {
  return [
    action,
    createEvent({
      eventId: `${action.eventId}:rejected`,
      timestamp: action.timestamp,
      type: "STEP_REJECTED",
      traineeId: action.traineeId,
      sessionId: action.sessionId,
      payload: { errorCode: code, rejectedType: action.type }
    }),
    createEvent({
      eventId: `${action.eventId}:error`,
      timestamp: action.timestamp,
      type: "ERROR",
      traineeId: action.traineeId,
      sessionId: action.sessionId,
      payload: { errorCode: code, details }
    })
  ];
}

function acceptState(state: PickState, action: AnyEvent): EmittedResult<PickState> {
  return emitMany(state, [action, accepted(action)]);
}

function rejectState(
  state: PickState,
  action: AnyEvent,
  code: ErrorCode,
  details?: Record<string, unknown>
): EmittedResult<PickState> {
  return emitMany(state, rejected(action, code, details));
}

function qtyBeforeItemState(status: PickStatus): boolean {
  return ["PK_IDLE", "PK_LOGGED_IN", "PK_PROGRAM_SELECTED", "PK_PHASE_SELECTED", "PK_TASK_ACTIVE", "PK_AT_LOCATION"].includes(status);
}

function toteBeforeItemState(status: PickStatus): boolean {
  return ["PK_IDLE", "PK_LOGGED_IN", "PK_PROGRAM_SELECTED", "PK_PHASE_SELECTED", "PK_TASK_ACTIVE", "PK_AT_LOCATION"].includes(status);
}

export function pickReducer(state: PickState, action: AnyEvent): EmittedResult<PickState> {
  if (action.type === "ENTER_QUANTITY" && qtyBeforeItemState(state.status)) {
    return rejectState(state, action, "ERR_SEQUENCE_QTY_BEFORE_ITEM");
  }

  if (action.type === "SCAN_TOTE_VERIFY") {
    if (toteBeforeItemState(state.status)) {
      return rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");
    }

    if (state.status === "PK_ITEM_SCANNED") {
      return rejectState(state, action, "ERR_SEQUENCE_QTY_MISSING");
    }
  }

  if (action.type === "RF_KEY_CTRL_A" && state.status !== "PK_END_OF_TOTE_PENDING") {
    return rejectState(state, action, "ERR_SEQUENCE_CTRL_A_TOO_EARLY");
  }

  if (action.type === "TOTE_PLACED_ON_CONVEYOR" && state.status !== "PK_TOTE_CONFIRMED") {
    return rejectState(state, action, "ERR_SEQUENCE_CTRL_A_TOO_EARLY");
  }

  switch (state.status) {
    case "PK_IDLE":
      return action.type === "RF_LOGIN"
        ? acceptState({ status: "PK_LOGGED_IN" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");

    case "PK_LOGGED_IN":
      return action.type === "RF_MENU_SELECT" && action.payload.value === "1"
        ? acceptState({ status: "PK_PROGRAM_SELECTED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");

    case "PK_PROGRAM_SELECTED":
      return action.type === "RF_MENU_SELECT" && action.payload.value === "2"
        ? acceptState({ status: "PK_PHASE_SELECTED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");

    case "PK_PHASE_SELECTED":
      return action.type === "PICK_ASSIGN"
        ? acceptState({ status: "PK_TASK_ACTIVE" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");

    case "PK_TASK_ACTIVE":
      return action.type === "ARRIVE_LOCATION"
        ? acceptState({ status: "PK_AT_LOCATION" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");

    case "PK_AT_LOCATION":
      return action.type === "SCAN_ITEM"
        ? acceptState({ status: "PK_ITEM_SCANNED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_TOTE_BEFORE_ITEM");

    case "PK_ITEM_SCANNED":
      return action.type === "ENTER_QUANTITY"
        ? acceptState({ status: "PK_QTY_ENTERED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_QTY_MISSING");

    case "PK_QTY_ENTERED":
      return action.type === "SCAN_TOTE_VERIFY"
        ? acceptState({ status: "PK_TOTE_VERIFIED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_QTY_MISSING");

    case "PK_TOTE_VERIFIED":
      if (action.type === "PICK_ASSIGN") {
        return acceptState({ status: "PK_TASK_ACTIVE" }, action);
      }

      return action.type === "RF_END_OF_TOTE_SHOWN"
        ? acceptState({ status: "PK_END_OF_TOTE_PENDING" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_CTRL_A_TOO_EARLY");

    case "PK_END_OF_TOTE_PENDING":
      return action.type === "RF_KEY_CTRL_A"
        ? acceptState({ status: "PK_TOTE_CONFIRMED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_CTRL_A_TOO_EARLY");

    case "PK_TOTE_CONFIRMED":
      return action.type === "TOTE_PLACED_ON_CONVEYOR"
        ? acceptState({ status: "PK_TOTE_CONVEYED" }, action)
        : rejectState(state, action, "ERR_SEQUENCE_CTRL_A_TOO_EARLY");

    case "PK_TOTE_CONVEYED":
      return rejectState(state, action, "ERR_SEQUENCE_CTRL_A_TOO_EARLY");
  }
}
