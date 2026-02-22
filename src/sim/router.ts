import { validateEvent, type AnyEvent } from "../contracts";
import { computeMetrics } from "./metrics";
import { buildCartReducer } from "./state-machines/buildCart";
import { pickReducer } from "./state-machines/pick";
import { getActivePickTask, type SessionState } from "./session";

function validateEmittedEventsOrThrow(events: readonly AnyEvent[]): void {
  for (const event of events) {
    const result = validateEvent(event);
    if (!result.ok) {
      throw new Error(`Invalid emitted event ${event.type}: ${(result.errors ?? []).join(" | ")}`);
    }
  }
}

function isAcceptedScanToteVerify(events: readonly AnyEvent[]): boolean {
  const hasAccepted = events.some((event) => event.type === "STEP_ACCEPTED");
  const hasScanToteVerify = events.some((event) => event.type === "SCAN_TOTE_VERIFY");

  return hasAccepted && hasScanToteVerify;
}

export function applyAction(session: SessionState, action: AnyEvent): SessionState {
  const priorMode = session.mode;

  if (session.mode === "buildCart") {
    const transition = buildCartReducer(session.buildCart.state, action, session.buildCart.config);
    validateEmittedEventsOrThrow(transition.emitted);

    const mode = transition.state.status === "BC_STARTED" ? "pick" : "buildCart";
    const nextLog = [...session.eventLog, ...transition.emitted] as const;
    const nextPick =
      mode === "pick" && priorMode !== "pick"
        ? {
            ...session.pick,
            activePickTaskId: session.scenario.pickTasks[session.pick.cursor]?.pickTaskId,
            endOfTotePending: transition.state.status === "BC_STARTED" ? false : session.pick.endOfTotePending
          }
        : session.pick;

    return {
      ...session,
      mode,
      buildCart: {
        ...session.buildCart,
        state: transition.state
      },
      pick: nextPick,
      eventLog: nextLog,
      metrics: computeMetrics(nextLog)
    };
  }

  const transition = pickReducer(session.pick.state, action);
  validateEmittedEventsOrThrow(transition.emitted);

  const shouldAdvanceCursor =
    transition.state.status === "PK_TOTE_VERIFIED" && isAcceptedScanToteVerify(transition.emitted);

  const cursor = shouldAdvanceCursor
    ? Math.min(session.pick.cursor + 1, session.scenario.pickTasks.length)
    : session.pick.cursor;

  const nextPick = {
    ...session.pick,
    state: transition.state,
    cursor,
    activePickTaskId: session.scenario.pickTasks[cursor]?.pickTaskId,
    endOfTotePending: transition.state.status === "PK_END_OF_TOTE_PENDING"
  };

  const nextLog = [...session.eventLog, ...transition.emitted] as const;

  const nextSession = {
    ...session,
    pick: nextPick,
    eventLog: nextLog,
    metrics: computeMetrics(nextLog)
  };

  const active = getActivePickTask(nextSession);
  if (nextSession.pick.activePickTaskId !== (active?.pickTaskId ?? undefined)) {
    return {
      ...nextSession,
      pick: {
        ...nextSession.pick,
        activePickTaskId: active?.pickTaskId
      }
    };
  }

  return nextSession;
}
