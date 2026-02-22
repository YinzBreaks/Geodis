import { createEvent } from "../../contracts";
import { emitMany } from "../emit";
export function createBuildCartInitialState() {
    return {
        status: "BC_IDLE",
        assignedTotes: []
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
function rejected(action, code, details) {
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
function acceptState(state, action) {
    return emitMany(state, [action, accepted(action)]);
}
function rejectState(state, action, code, details) {
    return emitMany(state, rejected(action, code, details));
}
export function buildCartReducer(state, action, config) {
    if (config.requiredToteCount <= 0) {
        throw new Error("BuildCartConfig.requiredToteCount must be > 0");
    }
    if (action.type === "RF_KEY_CTRL_E" && state.status !== "BC_READY_TO_START") {
        return rejectState(state, action, "ERR_SEQUENCE_CTRL_E_TOO_EARLY");
    }
    if (action.type === "SCAN_TOTE_ASSIGN") {
        if (!["BC_CART_SCANNED", "BC_TOTES_ASSIGNING"].includes(state.status)) {
            return rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_TOTE_ASSIGN" });
        }
        const barcode = action.payload.barcode;
        if (state.assignedTotes.includes(barcode)) {
            return rejectState(state, action, "ERR_TOTE_DUPLICATE_IN_SETUP", { barcode });
        }
        const nextAssigned = [...state.assignedTotes, barcode];
        const nextStatus = nextAssigned.length >= config.requiredToteCount ? "BC_READY_TO_START" : "BC_TOTES_ASSIGNING";
        return acceptState({ ...state, status: nextStatus, assignedTotes: nextAssigned }, action);
    }
    switch (state.status) {
        case "BC_IDLE":
            return action.type === "RF_LOGIN"
                ? acceptState({ ...state, status: "BC_LOGGED_IN" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_RF_LOGIN" });
        case "BC_LOGGED_IN":
            return action.type === "RF_MENU_SELECT" && action.payload.value === "1"
                ? acceptState({ ...state, status: "BC_PROGRAM_SELECTED" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_PROGRAM_SELECT_1" });
        case "BC_PROGRAM_SELECTED":
            return action.type === "RF_MENU_SELECT" && action.payload.value === "2"
                ? acceptState({ ...state, status: "BC_PHASE_SELECTED" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_PHASE_SELECT_2" });
        case "BC_PHASE_SELECTED":
            return action.type === "RF_KEY_CTRL_T"
                ? acceptState({ ...state, status: "BC_TASK_GROUP_MODE" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_CTRL_T" });
        case "BC_TASK_GROUP_MODE":
            if (action.type === "RF_TASK_GROUP_SET") {
                return acceptState(state, action);
            }
            return action.type === "RF_ZONE_SELECTED"
                ? acceptState({ ...state, status: "BC_ZONE_SELECTED" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_ZONE" });
        case "BC_ZONE_SELECTED":
            return action.type === "RF_MENU_SELECT" && action.payload.value === "1"
                ? acceptState({ ...state, status: "BC_MAKE_TOTE_CART_SELECTED" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_MAKE_TOTE_CART_MENU_1" });
        case "BC_MAKE_TOTE_CART_SELECTED":
            return action.type === "SCAN_CART_LABEL"
                ? acceptState({ ...state, status: "BC_CART_SCANNED" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_CART_LABEL_SCAN" });
        case "BC_CART_SCANNED":
        case "BC_TOTES_ASSIGNING":
            return rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_TOTE_ASSIGN" });
        case "BC_READY_TO_START":
            return action.type === "RF_KEY_CTRL_E"
                ? acceptState({ ...state, status: "BC_STARTED" }, action)
                : rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_TOTE_ASSIGN" });
        case "BC_STARTED":
            return rejectState(state, action, "ERR_SEQUENCE_SETUP_INCOMPLETE", { reason: "EXPECTED_TOTE_ASSIGN" });
    }
}
