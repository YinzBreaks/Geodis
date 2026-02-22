import { ERROR_CODES, type AnyEvent, type ErrorCode, type EventType } from "../contracts";

const PICK_ACTION_TYPES: readonly EventType[] = ["SCAN_ITEM", "ENTER_QUANTITY", "SCAN_TOTE_VERIFY"];
const CRITICAL_SEQUENCE_CODES: readonly ErrorCode[] = [
  "ERR_SEQUENCE_TOTE_BEFORE_ITEM",
  "ERR_SEQUENCE_QTY_BEFORE_ITEM",
  "ERR_SEQUENCE_QTY_MISSING",
  "ERR_SEQUENCE_CTRL_E_TOO_EARLY",
  "ERR_SEQUENCE_CTRL_A_TOO_EARLY",
  "ERR_SEQUENCE_SETUP_INCOMPLETE"
];

export const DEFAULT_CERTIFICATION_CONFIG = {
  accuracyTarget: 0.97,
  maxCriticalSequenceViolations: 0
} as const;

export type ProficiencyScore = {
  pickAccuracy: number;
  totalRejected: number;
  criticalSequenceViolations: number;
  rejectedByError: Record<ErrorCode, number>;
  passed: boolean;
  reasons: readonly string[];
};

export type CertificationConfig = {
  accuracyTarget: number;
  maxCriticalSequenceViolations: number;
};

function createRejectedByErrorMap(): Record<ErrorCode, number> {
  return Object.fromEntries(ERROR_CODES.map((code) => [code, 0])) as Record<ErrorCode, number>;
}

function getRelatedActionType(eventLog: readonly AnyEvent[], index: number): EventType | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const type = eventLog[cursor].type;
    if (type !== "STEP_ACCEPTED" && type !== "STEP_REJECTED" && type !== "ERROR") {
      return type;
    }
  }

  return null;
}

function isPickAcceptedEvent(eventLog: readonly AnyEvent[], index: number): boolean {
  const event = eventLog[index];
  const relatedType = (event.payload as Record<string, unknown>).acceptedType ?? getRelatedActionType(eventLog, index);

  return event.type === "STEP_ACCEPTED" && relatedType !== null && PICK_ACTION_TYPES.includes(relatedType as EventType);
}

function isPickRejectedEvent(eventLog: readonly AnyEvent[], index: number): boolean {
  const event = eventLog[index];
  if (event.type !== "STEP_REJECTED") {
    return false;
  }

  const relatedType = event.payload.rejectedType ?? getRelatedActionType(eventLog, index);
  return relatedType !== undefined && PICK_ACTION_TYPES.includes(relatedType as EventType);
}

export function scoreSession(eventLog: readonly AnyEvent[], config?: Partial<CertificationConfig>): ProficiencyScore {
  const effectiveConfig: CertificationConfig = {
    accuracyTarget: config?.accuracyTarget ?? DEFAULT_CERTIFICATION_CONFIG.accuracyTarget,
    maxCriticalSequenceViolations:
      config?.maxCriticalSequenceViolations ?? DEFAULT_CERTIFICATION_CONFIG.maxCriticalSequenceViolations
  };

  let acceptedPickActions = 0;
  let rejectedPickActions = 0;
  let totalRejected = 0;
  let criticalSequenceViolations = 0;

  const rejectedByError = createRejectedByErrorMap();

  for (let index = 0; index < eventLog.length; index += 1) {
    const event = eventLog[index];
    if (event.type !== "STEP_REJECTED" && event.type !== "STEP_ACCEPTED") {
      continue;
    }

    if (event.type === "STEP_ACCEPTED") {
      if (isPickAcceptedEvent(eventLog, index)) {
        acceptedPickActions += 1;
      }
      continue;
    }

    totalRejected += 1;
    const code = event.payload.errorCode;
    rejectedByError[code] += 1;

    if (isPickRejectedEvent(eventLog, index)) {
      rejectedPickActions += 1;
    }

    if (CRITICAL_SEQUENCE_CODES.includes(code)) {
      criticalSequenceViolations += 1;
    }
  }

  const pickAttempts = acceptedPickActions + rejectedPickActions;
  const pickAccuracy = pickAttempts > 0 ? acceptedPickActions / pickAttempts : 0;

  const reasons: string[] = [];

  if (pickAccuracy < effectiveConfig.accuracyTarget) {
    reasons.push("ACCURACY_BELOW_TARGET");
  }

  if (criticalSequenceViolations > effectiveConfig.maxCriticalSequenceViolations) {
    reasons.push("CRITICAL_SEQUENCE_VIOLATIONS");
  }

  reasons.sort((left, right) => left.localeCompare(right));

  return {
    pickAccuracy,
    totalRejected,
    criticalSequenceViolations,
    rejectedByError,
    passed: reasons.length === 0,
    reasons
  };
}
