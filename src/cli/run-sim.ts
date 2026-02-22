import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateEvent, type AnyEvent, type ErrorCode, type EventType } from "../contracts";
import { applyAction, createSession, scoreSession, validateScenario, type Scenario } from "../sim";

type RunSimOptions = {
  scenarioPath: string;
  actionsPath: string;
  traineeId: string;
  sessionId: string;
};

type RunSimResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ActionInput = {
  actions: AnyEvent[];
};

function formatCountMap<T extends string>(
  prefix: string,
  counts: ReadonlyMap<T, number>
): string {
  const parts = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);

  return parts.length > 0 ? `${prefix} ${parts.join(" ")}` : `${prefix} none`;
}

function parseArgs(args: readonly string[]): { ok: true; value: RunSimOptions } | { ok: false; error: string } {
  let scenarioPath: string | undefined;
  let actionsPath: string | undefined;
  let traineeId = "t1";
  let sessionId = "s1";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--scenario") {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: "Missing value for --scenario" };
      }
      scenarioPath = value;
      index += 1;
      continue;
    }

    if (arg === "--actions") {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: "Missing value for --actions" };
      }
      actionsPath = value;
      index += 1;
      continue;
    }

    if (arg === "--trainee") {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: "Missing value for --trainee" };
      }
      traineeId = value;
      index += 1;
      continue;
    }

    if (arg === "--session") {
      const value = args[index + 1];
      if (!value) {
        return { ok: false, error: "Missing value for --session" };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (!scenarioPath) {
    return { ok: false, error: "Missing required argument --scenario" };
  }

  if (!actionsPath) {
    return { ok: false, error: "Missing required argument --actions" };
  }

  return {
    ok: true,
    value: {
      scenarioPath,
      actionsPath,
      traineeId,
      sessionId
    }
  };
}

function readJsonFile(filePath: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const absolutePath = path.resolve(filePath);

  try {
    const raw = fs.readFileSync(absolutePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return { ok: true, value: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to read JSON file ${absolutePath}: ${message}` };
  }
}

function validateScenarioInput(input: unknown): { ok: true; scenario: Scenario } | { ok: false; errors: string[] } {
  const result = validateScenario(input);
  if (!result.ok) {
    return { ok: false, errors: result.errors ?? ["Scenario validation failed"] };
  }

  return { ok: true, scenario: input as Scenario };
}

function validateActionInput(input: unknown): { ok: true; actions: AnyEvent[] } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object" || !Array.isArray((input as ActionInput).actions)) {
    return {
      ok: false,
      errors: ["Actions JSON must be an object with an actions array"]
    };
  }

  const actions = (input as ActionInput).actions;
  const errors: string[] = [];

  actions.forEach((action, index) => {
    const validation = validateEvent(action);
    if (!validation.ok) {
      errors.push(`actions[${index}] ${(validation.errors ?? []).join(" | ")}`);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, actions };
}

function getLastErrorCode(eventLog: readonly AnyEvent[]): ErrorCode | "none" {
  for (let index = eventLog.length - 1; index >= 0; index -= 1) {
    const event = eventLog[index];
    if (event.type === "STEP_REJECTED") {
      return event.payload.errorCode;
    }

    if (event.type === "ERROR") {
      return event.payload.errorCode;
    }
  }

  return "none";
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

function buildSummaryLines(scenario: Scenario, eventLog: readonly AnyEvent[], session: ReturnType<typeof createSession>): string[] {
  const rejectedByError = new Map<ErrorCode, number>();
  const acceptedByType = new Map<EventType, number>();

  eventLog.forEach((event, index) => {
    if (event.type === "STEP_REJECTED") {
      const code = event.payload.errorCode;
      rejectedByError.set(code, (rejectedByError.get(code) ?? 0) + 1);
      return;
    }

    if (event.type === "STEP_ACCEPTED") {
      const acceptedType = getRelatedActionType(eventLog, index);
      if (acceptedType !== null) {
        acceptedByType.set(acceptedType, (acceptedByType.get(acceptedType) ?? 0) + 1);
      }
    }
  });

  const score = scoreSession(eventLog);
  const reasons = score.reasons.length > 0 ? [...score.reasons].sort((left, right) => left.localeCompare(right)).join(",") : "none";

  return [
    `SCENARIO ${scenario.id} mode=${scenario.mode}`,
    `FINAL mode=${session.mode} buildCart=${session.buildCart.state.status} pick=${session.pick.state.status} cursor=${session.pick.cursor}`,
    `METRICS totalActions=${session.metrics.totalActions} accepted=${session.metrics.totalAccepted} rejected=${session.metrics.totalRejected} lastError=${getLastErrorCode(eventLog)}`,
    `SCORE pickAccuracy=${score.pickAccuracy.toFixed(3)} criticalViolations=${score.criticalSequenceViolations} passed=${score.passed} reasons=${reasons}`,
    formatCountMap("REJECTED_BY_ERROR", rejectedByError),
    formatCountMap("ACCEPTED_BY_TYPE", acceptedByType)
  ];
}

export function runSimCli(args: string[]): RunSimResult {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const parsedArgs = parseArgs(args);
  if (!parsedArgs.ok) {
    stderrLines.push(parsedArgs.error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`
    };
  }

  const scenarioJson = readJsonFile(parsedArgs.value.scenarioPath);
  if (!scenarioJson.ok) {
    stderrLines.push(scenarioJson.error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`
    };
  }

  const validatedScenario = validateScenarioInput(scenarioJson.value);
  if (!validatedScenario.ok) {
    stderrLines.push(...validatedScenario.errors.map((error) => `Scenario validation: ${error}`));
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`
    };
  }

  const actionsJson = readJsonFile(parsedArgs.value.actionsPath);
  if (!actionsJson.ok) {
    stderrLines.push(actionsJson.error);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`
    };
  }

  const validatedActions = validateActionInput(actionsJson.value);
  if (!validatedActions.ok) {
    stderrLines.push(...validatedActions.errors.map((error) => `Actions validation: ${error}`));
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`
    };
  }

  try {
    const initialSession = createSession(validatedScenario.scenario, {
      traineeId: parsedArgs.value.traineeId,
      sessionId: parsedArgs.value.sessionId
    });

    const finalSession = validatedActions.actions.reduce(
      (session, action) => applyAction(session, action),
      initialSession
    );

    stdoutLines.push(...buildSummaryLines(validatedScenario.scenario, finalSession.eventLog, finalSession));

    return {
      exitCode: 0,
      stdout: `${stdoutLines.join("\n")}\n`,
      stderr: ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderrLines.push(`Engine execution failed: ${message}`);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${stderrLines.join("\n")}\n`
    };
  }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  const result = runSimCli(process.argv.slice(2));
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = result.exitCode;
}
