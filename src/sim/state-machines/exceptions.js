import { createEvent } from "../../contracts";
import { emitMany } from "../emit";
export const EXCEPTION_TO_ERROR_CODE = {
    EXCEPTION_TOTE_ALLOCATED: "ERR_TOTE_ALREADY_ALLOCATED",
    EXCEPTION_CART_ALREADY_CREATED: "ERR_CART_ALREADY_CREATED",
    EXCEPTION_SHORT_INVENTORY: "ERR_SHORT_INVENTORY",
    EXCEPTION_DAMAGED_ITEM: "ERR_DAMAGED_ITEM",
    EXCEPTION_INVALID_ITEM_LAST: "ERR_INVALID_ITEM",
    EXCEPTION_INVALID_ITEM_NOT_LAST: "ERR_INVALID_ITEM"
};
export function createExceptionsInitialState(initialStableState) {
    return {
        currentStableState: initialStableState,
        stableHistory: [initialStableState],
        scenarioPointer: 0,
        history: []
    };
}
function accepted(action) {
    return createEvent({
        eventId: `${action.eventId}:accepted`,
        timestamp: action.timestamp,
        type: "STEP_ACCEPTED",
        traineeId: action.traineeId,
        sessionId: action.sessionId,
        payload: {}
    });
}
function errorFrom(action, errorCode, details) {
    return createEvent({
        eventId: `${action.eventId}:error`,
        timestamp: action.timestamp,
        type: "ERROR",
        traineeId: action.traineeId,
        sessionId: action.sessionId,
        payload: { errorCode, details }
    });
}
export function exceptionsReducer(state, action) {
    const historyWithAction = [...state.history, action];
    if (action.type === "RF_KEY_CTRL_W") {
        const nextHistory = state.stableHistory.length > 1 ? state.stableHistory.slice(0, -1) : state.stableHistory;
        const revertedTo = nextHistory[nextHistory.length - 1] ?? state.currentStableState;
        const nextState = {
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
        const nextState = {
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
        const payload = action.payload;
        const stableState = payload.stableState;
        if (typeof stableState === "string" && stableState.length > 0) {
            const shouldAppend = state.stableHistory[state.stableHistory.length - 1] !== stableState;
            const nextStableHistory = shouldAppend ? [...state.stableHistory, stableState] : state.stableHistory;
            return emitMany({
                ...state,
                currentStableState: stableState,
                stableHistory: nextStableHistory,
                history: historyWithAction
            }, [action]);
        }
    }
    return emitMany({ ...state, history: historyWithAction }, [action, accepted(action)]);
}
