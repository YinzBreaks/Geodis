import { createEvent, type AnyEvent, type BaseEvent, type ErrorCode } from "../../contracts";
import { emitMany } from "../emit";
import type { EmittedResult } from "../types";

// SSoT: docs/Workflows/exceptions.md (WI 6.x)
export type ExceptionEventType =
  | "EXCEPTION_TOTE_ALLOCATED"
  | "EXCEPTION_CART_ALREADY_CREATED"
  | "EXCEPTION_SHORT_INVENTORY"
  | "EXCEPTION_DAMAGED_ITEM"
  | "EXCEPTION_INVALID_ITEM_LAST"
  | "EXCEPTION_INVALID_ITEM_NOT_LAST";

export const EXCEPTION_TO_ERROR_CODE: Record<ExceptionEventType, ErrorCode> = {
  EXCEPTION_TOTE_ALLOCATED: "ERR_TOTE_ALREADY_ALLOCATED",
  EXCEPTION_CART_ALREADY_CREATED: "ERR_CART_ALREADY_CREATED",
  EXCEPTION_SHORT_INVENTORY: "ERR_SHORT_INVENTORY",
  EXCEPTION_DAMAGED_ITEM: "ERR_DAMAGED_ITEM",
  EXCEPTION_INVALID_ITEM_LAST: "ERR_INVALID_ITEM",
  EXCEPTION_INVALID_ITEM_NOT_LAST: "ERR_INVALID_ITEM"
};

export type ExceptionsState = {
  currentStableState: string;
  stableHistory: readonly string[];
  scenarioPointer: number;
  history: readonly AnyEvent[];
};

export function createExceptionsInitialState(initialStableState: string): ExceptionsState {
  return {
    currentStableState: initialStableState,
    stableHistory: [initialStableState],
    scenarioPointer: 0,
    history: []
  };
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

function errorFrom(action: AnyEvent, errorCode: ErrorCode, details?: Record<string, unknown>): BaseEvent<"ERROR"> {
  return createEvent({
    eventId: `${action.eventId}:error`,
    timestamp: action.timestamp,
    type: "ERROR",
    traineeId: action.traineeId,
    sessionId: action.sessionId,
    payload: { errorCode, details }
  });
}

export function exceptionsReducer(state: ExceptionsState, action: AnyEvent): EmittedResult<ExceptionsState> {
  const historyWithAction = [...state.history, action];

  if (action.type === "RF_KEY_CTRL_W") {
    const nextHistory = state.stableHistory.length > 1 ? state.stableHistory.slice(0, -1) : state.stableHistory;
    const revertedTo = nextHistory[nextHistory.length - 1] ?? state.currentStableState;

    const nextState: ExceptionsState = {
      ...state,
      currentStableState: revertedTo,
      stableHistory: nextHistory,
      history: historyWithAction
    };

    return emitMany(nextState, [action, accepted(action)]);
  }

  if (action.type === "RF_KEY_CTRL_K") {
    const nextPointer = state.scenarioPointer + 1;
    const exceptionEvent = createEvent({
      eventId: `${action.eventId}:exception`,
      timestamp: action.timestamp,
      type: "EXCEPTION_SHORT_INVENTORY",
      traineeId: action.traineeId,
      sessionId: action.sessionId,
      payload: {}
    });

    const nextState: ExceptionsState = {
      ...state,
      scenarioPointer: nextPointer,
      history: [...historyWithAction, exceptionEvent]
    };

    return emitMany(nextState, [
      action,
      exceptionEvent,
      errorFrom(action, EXCEPTION_TO_ERROR_CODE.EXCEPTION_SHORT_INVENTORY, {
        fromPointer: state.scenarioPointer,
        toPointer: nextPointer
      }),
      accepted(action)
    ]);
  }

  if (action.type === "STEP_ACCEPTED") {
    const payload = action.payload as Record<string, unknown>;
    const stableState = payload.stableState;
    if (typeof stableState === "string" && stableState.length > 0) {
      const shouldAppend = state.stableHistory[state.stableHistory.length - 1] !== stableState;
      const nextStableHistory = shouldAppend ? [...state.stableHistory, stableState] : state.stableHistory;

      return emitMany(
        {
          ...state,
          currentStableState: stableState,
          stableHistory: nextStableHistory,
          history: historyWithAction
        },
        [action]
      );
    }
  }

  return emitMany({ ...state, history: historyWithAction }, [action, accepted(action)]);
}
