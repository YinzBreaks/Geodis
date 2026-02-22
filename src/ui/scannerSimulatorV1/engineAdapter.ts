import { validateEvent } from "../../contracts/schema.js";
import { createEvent, type AnyEvent } from "../../contracts/events.js";
import { applyAction } from "../../sim/router.js";
import type { SessionState } from "../../sim/session.js";
import type { ScannerSimAdapter, ScannerSimViewModel, UiEvent } from "./types.js";

export type EngineAdapterViewDefaults = {
  timerText: string;
  progressText: string;
  errorText: string;
  accuracyText: string;
  instructionText: string;
};

export const DEFAULT_ENGINE_ADAPTER_VIEW_DEFAULTS: Readonly<EngineAdapterViewDefaults> = Object.freeze({
  timerText: "--:--",
  progressText: "0/0",
  errorText: "0",
  accuracyText: "--",
  instructionText: "READY"
});

export type CreateEngineScannerSimAdapterParams = {
  getSessionState: () => SessionState;
  setSessionState: (next: SessionState) => void;
  mapUiEventToEngineEvents: (event: UiEvent, session: SessionState) => readonly AnyEvent[];
  applyActionToSession?: (session: SessionState, event: AnyEvent) => SessionState;
  validateEngineEvent?: (event: AnyEvent) => void;
  toViewModel?: (session: SessionState, defaults: Readonly<EngineAdapterViewDefaults>) => ScannerSimViewModel;
  viewDefaults?: Partial<EngineAdapterViewDefaults>;
};

function defaultValidateEngineEvent(event: AnyEvent): void {
  const result = validateEvent(event);
  if (!result.ok) {
    throw new Error(`Invalid engine event ${event.type}: ${(result.errors ?? []).join(" | ")}`);
  }
}

function defaultToViewModel(_session: SessionState, defaults: Readonly<EngineAdapterViewDefaults>): ScannerSimViewModel {
  return {
    header: {
      timerText: defaults.timerText,
      progressText: defaults.progressText,
      errorText: defaults.errorText,
      accuracyText: defaults.accuracyText
    },
    instructionText: defaults.instructionText,
    feedback: {
      kind: "NONE"
    }
  };
}

export function createEngineScannerSimAdapter(params: CreateEngineScannerSimAdapterParams): ScannerSimAdapter {
  const defaults: Readonly<EngineAdapterViewDefaults> = {
    ...DEFAULT_ENGINE_ADAPTER_VIEW_DEFAULTS,
    ...params.viewDefaults
  };

  const validateEventOrThrow = params.validateEngineEvent ?? defaultValidateEngineEvent;
  const reduceSession = params.applyActionToSession ?? applyAction;
  const mapViewModel = params.toViewModel ?? defaultToViewModel;

  return {
    getViewModel(): ScannerSimViewModel {
      const session = params.getSessionState();
      return mapViewModel(session, defaults);
    },

    mapUiEventToEngineEvents(event: UiEvent): AnyEvent[] {
      const session = params.getSessionState();
      return [...params.mapUiEventToEngineEvents(event, session)];
    },

    validateEngineEvent(event: AnyEvent): void {
      validateEventOrThrow(event);
    },

    applyEngineEvents(events: AnyEvent[]): void {
      for (const event of events) {
        validateEventOrThrow(event);
      }

      let nextSession = params.getSessionState();
      for (const event of events) {
        nextSession = reduceSession(nextSession, event);
      }

      params.setSessionState(nextSession);
    }
  };
}
/**
 * Returns a mapping function that converts a UI_SCAN_SUBMITTED event into a
 * SCAN_ITEM engine event.  All engine-type knowledge lives here in the adapter
 * layer — callers supply only a deterministic event-id generator.
 */
export function createDefaultUiToEngineMapper(
  getNextEventId: () => string
): (event: UiEvent, session: SessionState) => readonly AnyEvent[] {
  return (event, session) => [
    createEvent({
      eventId: getNextEventId(),
      timestamp: new Date(event.payload.timestampMs).toISOString(),
      type: "SCAN_ITEM",
      traineeId: session.traineeId,
      sessionId: session.sessionId,
      payload: { barcode: event.payload.value }
    })
  ];
}

function extractLastScanValue(session: SessionState): string | undefined {
  for (let index = session.eventLog.length - 1; index >= 0; index -= 1) {
    const ev = session.eventLog[index];
    if (ev.type === "SCAN_ITEM") {
      const barcode = (ev.payload as { barcode?: unknown }).barcode;
      if (typeof barcode === "string") {
        return barcode;
      }
    }
  }

  return undefined;
}

function extractScanHistory(session: SessionState): readonly string[] {
  const scans: string[] = [];
  for (let index = session.eventLog.length - 1; index >= 0; index -= 1) {
    const ev = session.eventLog[index];
    if (ev.type === "SCAN_ITEM") {
      const barcode = (ev.payload as { barcode?: unknown }).barcode;
      if (typeof barcode === "string") {
        scans.push(barcode);
      }
    }

    if (scans.length >= 3) {
      break;
    }
  }

  return scans;
}

/**
 * Derives a ScannerSimViewModel from session state.  Engine event-type
 * inspection (SCAN_ITEM, STEP_REJECTED, STEP_ACCEPTED, ERROR) belongs here in
 * the adapter layer, not in the UI.  Pass this as the `toViewModel` param of
 * createEngineScannerSimAdapter to get rich feedback + scan history without
 * leaking engine semantics into UI code.
 */
export function createSessionViewModel(
  session: SessionState,
  defaults: Readonly<EngineAdapterViewDefaults>
): ScannerSimViewModel {
  const attempts = session.metrics.totalAccepted + session.metrics.totalRejected;
  const accuracy =
    attempts > 0
      ? `${Math.round((session.metrics.totalAccepted / attempts) * 100)}%`
      : defaults.accuracyText;

  const lastEv = session.eventLog.length > 0 ? session.eventLog[session.eventLog.length - 1] : null;
  const lastPayload = lastEv ? (lastEv.payload as Record<string, unknown>) : null;

  const feedback: ScannerSimViewModel["feedback"] =
    lastEv?.type === "STEP_REJECTED"
      ? {
          kind: "ERROR",
          code: String(lastPayload?.errorCode ?? ""),
          message: `Rejected: ${String(lastPayload?.errorCode ?? "")}`
        }
      : lastEv?.type === "ERROR"
        ? {
            kind: "ERROR",
            code: String(lastPayload?.errorCode ?? ""),
            message: `Error: ${String(lastPayload?.errorCode ?? "")}`
          }
        : lastEv?.type === "STEP_ACCEPTED"
          ? { kind: "SUCCESS", message: "Accepted" }
          : { kind: "NONE" };

  return {
    header: {
      timerText: defaults.timerText,
      progressText: `${session.pick.cursor}/${session.scenario.pickTasks.length}`,
      errorText: `${session.metrics.totalRejected}`,
      accuracyText: accuracy
    },
    instructionText: `MODE ${session.mode.toUpperCase()} | BUILD ${session.buildCart.state.status} | PICK ${session.pick.state.status}`,
    feedback,
    lastScanEcho: extractLastScanValue(session),
    scanHistory: extractScanHistory(session)
  };
}