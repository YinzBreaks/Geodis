# GEODIS Picker LMS — Full Technical Summary

> **Purpose of this document:** A single-stop reference for the complete technical and functional state of the project as of 2026-02-22. This is a descriptive snapshot — not a governance or authority document. The SSoT hierarchy defined in [ARCHITECTURE.md](ARCHITECTURE.md) takes precedence.

---

## Table of Contents

1. [Project Purpose](#1-project-purpose)
2. [Technology Stack](#2-technology-stack)
3. [Repository Layout at a Glance](#3-repository-layout-at-a-glance)
4. [Core Design Principles](#4-core-design-principles)
5. [Contracts Layer](#5-contracts-layer)
6. [Engine — Simulation Core](#6-engine--simulation-core)
7. [State Machines — Complete Transition Tables](#7-state-machines--complete-transition-tables)
8. [Scoring & Certification](#8-scoring--certification)
9. [CLI — Headless Replay Runner](#9-cli--headless-replay-runner)
10. [UI Layer — ScannerSimulatorV1](#10-ui-layer--scannersimulatorv1)
11. [Dev Portal](#11-dev-portal)
12. [Fixture / Scenario System](#12-fixture--scenario-system)
13. [Test Suite](#13-test-suite)
14. [Build & Tooling](#14-build--tooling)
15. [What Is Not Yet Built](#15-what-is-not-yet-built)
16. [Dependency Map](#16-dependency-map)

---

## 1. Project Purpose

The GEODIS Picker LMS is a **deterministic training simulator** for GEODIS warehouse RF-picking operations. Its goal is to reduce new-hire ramp time to independent picking readiness — from approximately four weeks down to a measurable, lower target — by enforcing correct muscle memory and procedural compliance through repetitive simulation.

The system enforces three core workflows taken directly from the GEODIS Work Instruction BBWD-WI-030:

| Workflow | WI Reference |
|---|---|
| Build Cart (Make Tote Cart BB) | Procedure 5.1 |
| Pick Execution Order | Procedure 5.2 |
| Exception Handling (CTRL+W / CTRL+K) | Section 6.x |

**Every trainee action produces a structured event.** Every event is schema-validated. No simulator behavior occurs without event emission. Same inputs always produce same outputs — no hidden transitions, no randomness unless seeded.

---

## 2. Technology Stack

| Concern | Technology |
|---|---|
| Language | TypeScript 5.8 (strict, ESM) |
| Runtime | Node.js (CLI + tests); browser-native ESM (UI) |
| Test runner | Vitest 3.0 |
| JSON Schema validation | ajv (2020-12 draft) + ajv-formats |
| DOM / UI test environment | jsdom 28 |
| UI framework | **None** — raw DOM APIs only |
| Bundler | **None** — unbundled ESM for dev, tsc for compile |
| Persistence / backend | **None** — all state is in-memory per session |
| Package manager | npm |

All TypeScript source files in `src/` are compiled to sibling `.js` files by `tsc`. Both are committed to the repo so the browser dev portal can load raw ESM without a build step.

---

## 3. Repository Layout at a Glance

```
geoLMS/
├── dev/scanner/index.html          ← Dev browser entry (served at /dev/scanner)
├── docs/
│   ├── ARCHITECTURE.md             ← Architecture overview (authoritative)
│   ├── PROJECT_SUMMARY.md          ← This file
│   ├── geodis-picker-training-spec.md   ← Spec v2 (populated)
│   ├── contracts/
│   │   ├── events.schema.json      ← Canonical event schema (SSoT)
│   │   ├── errors.json             ← Canonical error codes (SSoT)
│   │   └── scenario.schema.json    ← Scenario validation schema
│   ├── fixtures/scenarios/         ← 3 active + 1 invalid fixture JSON files
│   ├── AI/                         ← Role & guardrail docs (2 populated, rest empty)
│   └── Workflows/                  ← build-cart.md / pick.md / exceptions.md (all EMPTY stubs)
├── src/
│   ├── cli/run-sim.ts              ← Headless CLI runner
│   ├── contracts/                  ← TypeScript contract mirror + validators
│   ├── sim/                        ← Engine core
│   │   ├── router.ts               ← applyAction() — central dispatch
│   │   ├── session.ts              ← SessionState + createSession()
│   │   ├── scenario.ts             ← Scenario type + JSON validation
│   │   ├── metrics.ts              ← Live metrics from event log
│   │   ├── scoring.ts              ← scoreSession() — pass/fail logic
│   │   ├── certification.ts        ← 3-session certification gate
│   │   └── state-machines/
│   │       ├── buildCart.ts        ← Build Cart (WI 5.1)
│   │       ├── pick.ts             ← Pick (WI 5.2)
│   │       └── exceptions.ts       ← Exception dispatcher (WI 6.x)
│   └── ui/
│       ├── dev/                    ← Dev portal bootstrap + routes + playground
│       └── scannerSimulatorV1/     ← UI component + adapter boundary
├── tests/                          ← Vitest specs
├── scripts/validate-contracts.mjs  ← Contract lint
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## 4. Core Design Principles

### 4.1 Event Sourcing

Every simulator action emits one or more `AnyEvent` objects. These are appended to an immutable `eventLog: readonly AnyEvent[]` on `SessionState`. All scoring and metrics are derived entirely from the event log — there are no separate counters or flags. Rolling back to any point in time means replaying the event log up to that point.

### 4.2 Strict Immutability

`SessionState` is never mutated in place. Every call to `applyAction()` returns a **new** `SessionState` object. Events are `deepFreeze()`d after creation. There are no global variables holding engine state.

### 4.3 Contracts as Runtime Guards

The TypeScript contracts (`src/contracts/events.ts`, `src/contracts/errors.ts`) are not just types — they have **runtime sync guards**. At module load time, `ensureCanonicalEventTypes()` and `ensureCanonicalCodes()` compare the in-code constants against the JSON schema documents. If they diverge, the module throws immediately before any simulator code can run.

### 4.4 No Business Logic in the UI

The UI component (`scannerSimulatorV1`) receives only a `ScannerSimViewModel` (plain data) and emits only a `UiEvent`. It has no knowledge of:
- Event types
- Error codes
- Session modes
- State machine statuses

All interpretation of engine state happens in `engineAdapter.ts`. All workflow logic happens in the state machines.

### 4.5 Schema Validation on Every Emit

Before any event is committed to the `eventLog`, `validateEmittedEventsOrThrow()` in `src/sim/router.ts` runs every emitted event through ajv validation against `docs/contracts/events.schema.json`. This is a hard throw, not a soft warning — a bug in a state machine that produces an invalid event will crash immediately at the point of emission.

---

## 5. Contracts Layer

### 5.1 Event Schema

**File:** `docs/contracts/events.schema.json` (278 lines, JSON Schema 2020-12)  
**Mirror:** `src/contracts/events.ts`

#### 31 Canonical Event Types

**RF / Navigation (5):**
- `RF_LOGIN`, `RF_MENU_SELECT`, `RF_KEY_CTRL_T`, `RF_TASK_GROUP_SET`, `RF_ZONE_SELECTED`

**Build Cart (3):**
- `SCAN_CART_LABEL`, `SCAN_TOTE_ASSIGN`, `RF_KEY_CTRL_E`

**Pick (8):**
- `PICK_ASSIGN`, `ARRIVE_LOCATION`, `SCAN_ITEM`, `ENTER_QUANTITY`, `SCAN_TOTE_VERIFY`
- `RF_END_OF_TOTE_SHOWN`, `RF_KEY_CTRL_A`, `TOTE_PLACED_ON_CONVEYOR`

**Exceptions (8):**
- `RF_KEY_CTRL_W`, `RF_KEY_CTRL_K`
- `EXCEPTION_TOTE_ALLOCATED`, `EXCEPTION_CART_ALREADY_CREATED`
- `EXCEPTION_INCORRECT_LOCATION`, `EXCEPTION_INCORRECT_TOTE`
- `EXCEPTION_INVALID_ITEM_LAST`, `EXCEPTION_INVALID_ITEM_NOT_LAST`
- `EXCEPTION_SHORT_INVENTORY`, `EXCEPTION_DAMAGED_ITEM`

**Outcomes (3):**
- `STEP_ACCEPTED`, `STEP_REJECTED`, `ERROR`

#### Event Structure

Every event shares these required fields:

```typescript
BaseEvent<T extends EventType> {
  eventId:    string (minLength 8)
  timestamp:  string (ISO 8601 date-time)
  type:       EventType
  traineeId:  string (minLength 1)
  sessionId:  string (minLength 1)
  payload:    object  // shape enforced by per-type allOf conditions in schema

  // Optional contextual fields:
  cartSessionId?: string
  cartId?:        string
  roundNumber?:   integer (≥ 0)
  pickTaskId?:    string
}
```

Payload types with enforced schemas include: `RF_MENU_SELECT` (`{value: string}`), `RF_ZONE_SELECTED` (`{zoneOrTaskGroupCode: string}`), `SCAN_CART_LABEL` (`{barcode: string}`), `SCAN_TOTE_ASSIGN` (`{barcode: string, slotIndex: number}`), `SCAN_ITEM` (`{barcode: string}`), `ENTER_QUANTITY` (`{quantity: number}`), `SCAN_TOTE_VERIFY` (`{barcode: string}`), `STEP_REJECTED` (`{errorCode, rejectedType?}`), `ERROR` (`{errorCode, details?}`). Many events have empty payloads (`{}`).

### 5.2 Error Codes

**File:** `docs/contracts/errors.json`  
**Mirror:** `src/contracts/errors.ts`

#### 19 Canonical Error Codes

**Sequence Errors (6):** Violations of required step order
- `ERR_SEQUENCE_TOTE_BEFORE_ITEM` — Tote scanned before item scan
- `ERR_SEQUENCE_QTY_BEFORE_ITEM` — Quantity entered before item scan
- `ERR_SEQUENCE_QTY_MISSING` — Tote scanned without quantity entry
- `ERR_SEQUENCE_CTRL_E_TOO_EARLY` — CTRL+E pressed before totes fully assigned
- `ERR_SEQUENCE_CTRL_A_TOO_EARLY` — CTRL+A pressed before End Of Tote screen shown
- `ERR_SEQUENCE_SETUP_INCOMPLETE` — Any other out-of-sequence action during Build Cart

**Validation Errors (5):** Wrong data supplied in the right step
- `ERR_WRONG_ITEM_SCANNED`
- `ERR_ITEM_NOT_RECOGNIZED`
- `ERR_WRONG_TOTE_SCANNED`
- `ERR_TOTE_DUPLICATE_IN_SETUP`
- `ERR_TOTE_SLOT_MISMATCH`

**Operational Exceptions (8):** Real-world warehouse conditions
- `ERR_TOTE_ALREADY_ALLOCATED`
- `ERR_CART_ALREADY_CREATED`
- `ERR_SHORT_INVENTORY`
- `ERR_DAMAGED_ITEM`
- `ERR_INVALID_ITEM`

### 5.3 Scenario Schema

**File:** `docs/contracts/scenario.schema.json`  
**Used by:** `src/sim/scenario.ts` (validated at load time against this schema via ajv)

### 5.4 Contract Sync Guard Pattern

Both `events.ts` and `errors.ts` use the same pattern:

1. A `CANONICAL_*` constant array is defined directly in the TypeScript file.
2. At module load, a function reads the corresponding JSON file and compares lengths + membership.
3. If there is any mismatch, the function throws — the process cannot run with a drift between code and schema.

This means you **cannot silently add an event type to the JSON schema without also updating the TypeScript file**, and vice versa. The lint script (`scripts/validate-contracts.mjs`) adds an additional CI-time layer.

---

## 6. Engine — Simulation Core

### 6.1 Data Flow

```
UI layer (browser)
  └─ User types text into input and presses Enter
       │
       ▼  UiEvent { type: "UI_SCAN_SUBMITTED", payload: { value, timestampMs } }
  EngineAdapter.mapUiEventToEngineEvents()
       │  ← transforms raw input into one or more typed AnyEvent objects
       ▼  AnyEvent[]  (e.g. [SCAN_ITEM { barcode: "12345" }])
  EngineAdapter.applyEngineEvents()
       │  ← validates each event against JSON schema
       ▼
  applyAction(session, event)   [src/sim/router.ts]
       │  ← branches on session.mode
       ▼
  buildCartReducer(state, action, config)   OR   pickReducer(state, action)
       │  ← returns EmittedResult<State> = { state, emitted: AnyEvent[] }
       ▼
  validateEmittedEventsOrThrow(emitted)
       │  ← all emitted events validated; throws on any schema violation
       ▼
  New SessionState with:
    - updated buildCart.state or pick.state
    - updated pick.cursor (if tote verify accepted)
    - eventLog = [...old, ...emitted]
    - metrics = computeMetrics(eventLog)
       │
       ▼
  EngineAdapter.setSessionState(next)
       │  ← triggers UI re-render
       ▼
  createSessionViewModel(session, defaults)
       │  ← pure projection: no logic
       ▼
  ScannerSimulatorV1.render()
```

### 6.2 SessionState

```typescript
SessionState {
  mode:        "buildCart" | "pick"
  scenarioId:  string
  traineeId:   string
  sessionId:   string
  scenario:    Scenario             // immutable reference to loaded fixture
  buildCart: {
    state:   BuildCartState         // current step status + assignedTotes[]
    config:  { requiredToteCount }  // from scenario.buildCart.requiredToteCount
  }
  pick: {
    state:            PickState     // current pick step status
    cursor:           number        // index into scenario.pickTasks[]
    activePickTaskId: string | undefined
    endOfTotePending: boolean       // mirrors state === PK_END_OF_TOTE_PENDING
    config:           {}            // reserved; currently empty
  }
  eventLog:  readonly AnyEvent[]    // append-only; never mutated
  metrics:   DerivedMetrics         // recomputed from full eventLog on every action
}
```

**Mode transition:** `"buildCart"` → `"pick"` occurs in `applyAction()` when `buildCartReducer` returns a state with `status === "BC_STARTED"`. This is the only mode transition path. There is no return to `"buildCart"` mode once `"pick"` starts.

### 6.3 DerivedMetrics

```typescript
DerivedMetrics {
  totalActions:   number               // non-outcome events
  totalAccepted:  number               // STEP_ACCEPTED events
  totalRejected:  number               // STEP_REJECTED events
  rejectedByError: Record<ErrorCode, number>  // per-code rejection counts
}
```

`computeMetrics()` scans the full event log on every update. This is O(n) per action, which is acceptable at current scale (training sessions are bounded in length).

---

## 7. State Machines — Complete Transition Tables

### 7.1 Build Cart (`src/sim/state-machines/buildCart.ts`)

WI Reference: BBWD-WI-030, Procedure 5.1

#### States (11)

`BC_IDLE` → `BC_LOGGED_IN` → `BC_PROGRAM_SELECTED` → `BC_PHASE_SELECTED` → `BC_TASK_GROUP_MODE` → `BC_ZONE_SELECTED` → `BC_MAKE_TOTE_CART_SELECTED` → `BC_CART_SCANNED` → `BC_TOTES_ASSIGNING` → `BC_READY_TO_START` → `BC_STARTED`

#### Accepted Transitions

| From State | Event (with condition) | Next State |
|---|---|---|
| `BC_IDLE` | `RF_LOGIN` | `BC_LOGGED_IN` |
| `BC_LOGGED_IN` | `RF_MENU_SELECT { value: "1" }` | `BC_PROGRAM_SELECTED` |
| `BC_PROGRAM_SELECTED` | `RF_MENU_SELECT { value: "2" }` | `BC_PHASE_SELECTED` |
| `BC_PHASE_SELECTED` | `RF_KEY_CTRL_T` | `BC_TASK_GROUP_MODE` |
| `BC_TASK_GROUP_MODE` | `RF_TASK_GROUP_SET` | `BC_TASK_GROUP_MODE` (stays) |
| `BC_TASK_GROUP_MODE` | `RF_ZONE_SELECTED` | `BC_ZONE_SELECTED` |
| `BC_ZONE_SELECTED` | `RF_MENU_SELECT { value: "1" }` | `BC_MAKE_TOTE_CART_SELECTED` |
| `BC_MAKE_TOTE_CART_SELECTED` | `SCAN_CART_LABEL` | `BC_CART_SCANNED` |
| `BC_CART_SCANNED` or `BC_TOTES_ASSIGNING` | `SCAN_TOTE_ASSIGN` (unique barcode) | `BC_TOTES_ASSIGNING` or `BC_READY_TO_START`* |
| `BC_READY_TO_START` | `RF_KEY_CTRL_E` | `BC_STARTED` |

*Transitions to `BC_READY_TO_START` when `assignedTotes.length >= requiredToteCount`.

#### Rejection Rules

| Condition | Error Code |
|---|---|
| `RF_KEY_CTRL_E` when state ≠ `BC_READY_TO_START` | `ERR_SEQUENCE_CTRL_E_TOO_EARLY` |
| `SCAN_TOTE_ASSIGN` duplicate barcode | `ERR_TOTE_DUPLICATE_IN_SETUP` |
| `SCAN_TOTE_ASSIGN` when state not in tote-assign states | `ERR_SEQUENCE_SETUP_INCOMPLETE` |
| Any wrong event for current state | `ERR_SEQUENCE_SETUP_INCOMPLETE` |

Every rejection emits: `[action, STEP_REJECTED { errorCode }, ERROR { errorCode }]`.  
Every acceptance emits: `[action, STEP_ACCEPTED]`.

### 7.2 Pick (`src/sim/state-machines/pick.ts`)

WI Reference: BBWD-WI-030, Procedure 5.2

#### States (12)

`PK_IDLE` → `PK_LOGGED_IN` → `PK_PROGRAM_SELECTED` → `PK_PHASE_SELECTED` → `PK_TASK_ACTIVE` → `PK_AT_LOCATION` → `PK_ITEM_SCANNED` → `PK_QTY_ENTERED` → `PK_TOTE_VERIFIED` → `PK_END_OF_TOTE_PENDING` → `PK_TOTE_CONFIRMED` → `PK_TOTE_CONVEYED`

#### Accepted Transitions

| From State | Event | Next State |
|---|---|---|
| `PK_IDLE` | `RF_LOGIN` | `PK_LOGGED_IN` |
| `PK_LOGGED_IN` | `RF_MENU_SELECT { value: "1" }` | `PK_PROGRAM_SELECTED` |
| `PK_PROGRAM_SELECTED` | `RF_MENU_SELECT { value: "2" }` | `PK_PHASE_SELECTED` |
| `PK_PHASE_SELECTED` | `PICK_ASSIGN` | `PK_TASK_ACTIVE` |
| `PK_TASK_ACTIVE` | `ARRIVE_LOCATION` | `PK_AT_LOCATION` |
| `PK_AT_LOCATION` | `SCAN_ITEM` | `PK_ITEM_SCANNED` |
| `PK_ITEM_SCANNED` | `ENTER_QUANTITY` | `PK_QTY_ENTERED` |
| `PK_QTY_ENTERED` | `SCAN_TOTE_VERIFY` | `PK_TOTE_VERIFIED` |
| `PK_TOTE_VERIFIED` | `PICK_ASSIGN` | `PK_TASK_ACTIVE` (next pick) |
| `PK_TOTE_VERIFIED` | `RF_END_OF_TOTE_SHOWN` | `PK_END_OF_TOTE_PENDING` |
| `PK_END_OF_TOTE_PENDING` | `RF_KEY_CTRL_A` | `PK_TOTE_CONFIRMED` |
| `PK_TOTE_CONFIRMED` | `TOTE_PLACED_ON_CONVEYOR` | `PK_TOTE_CONVEYED` |

**Cursor advance:** In `applyAction()`, after a `SCAN_TOTE_VERIFY` returns `STEP_ACCEPTED`, `session.pick.cursor` increments by 1, pointing to the next `PickTask` in the scenario.

#### Pre-condition Rejection Rules (checked before state switch)

| Condition | Error Code |
|---|---|
| `ENTER_QUANTITY` when state is pre-`PK_ITEM_SCANNED` | `ERR_SEQUENCE_QTY_BEFORE_ITEM` |
| `SCAN_TOTE_VERIFY` when state is pre-`PK_ITEM_SCANNED` | `ERR_SEQUENCE_TOTE_BEFORE_ITEM` |
| `SCAN_TOTE_VERIFY` when state is `PK_ITEM_SCANNED` (qty not yet entered) | `ERR_SEQUENCE_QTY_MISSING` |
| `RF_KEY_CTRL_A` when state ≠ `PK_END_OF_TOTE_PENDING` | `ERR_SEQUENCE_CTRL_A_TOO_EARLY` |
| `TOTE_PLACED_ON_CONVEYOR` when state ≠ `PK_TOTE_CONFIRMED` | `ERR_SEQUENCE_CTRL_A_TOO_EARLY` |

### 7.3 Exceptions (`src/sim/state-machines/exceptions.ts`)

WI Reference: BBWD-WI-030, Section 6.x

This is **not a session mode**. It is a standalone reducer used to model exception navigation. It maintains its own `ExceptionsState` with a `stableHistory` stack for back-navigation.

#### Exception Event → Error Code Map

| Input Event | Emitted Error Code |
|---|---|
| `EXCEPTION_TOTE_ALLOCATED` | `ERR_TOTE_ALREADY_ALLOCATED` |
| `EXCEPTION_CART_ALREADY_CREATED` | `ERR_CART_ALREADY_CREATED` |
| `EXCEPTION_SHORT_INVENTORY` | `ERR_SHORT_INVENTORY` |
| `EXCEPTION_DAMAGED_ITEM` | `ERR_DAMAGED_ITEM` |
| `EXCEPTION_INVALID_ITEM_LAST` | `ERR_INVALID_ITEM` |
| `EXCEPTION_INVALID_ITEM_NOT_LAST` | `ERR_INVALID_ITEM` |

#### Key Behaviors

- **`RF_KEY_CTRL_W`** — Goes back: pops the last stable state from `stableHistory`. Always accepted.
- **`RF_KEY_CTRL_K`** — Short inventory: emits `EXCEPTION_SHORT_INVENTORY` + associated `ERROR`, increments `scenarioPointer`. Always accepted.
- **`STEP_ACCEPTED { stableState }`** — When a stable state name is provided in the payload, the exceptions reducer appends it to `stableHistory` and updates `currentStableState`.

---

## 8. Scoring & Certification

### 8.1 scoreSession()

**File:** `src/sim/scoring.ts`

Scans the full `eventLog` to compute a `ProficiencyScore`. Pick actions used for accuracy are: `SCAN_ITEM`, `ENTER_QUANTITY`, `SCAN_TOTE_VERIFY`.

```typescript
ProficiencyScore {
  pickAccuracy:               number    // acceptedPickActions / totalPickAttempts
  totalRejected:              number    // all STEP_REJECTED events
  criticalSequenceViolations: number    // rejections with CRITICAL_SEQUENCE_CODES
  rejectedByError:            Record<ErrorCode, number>
  passed:                     boolean
  reasons:                    string[]  // "ACCURACY_BELOW_TARGET" | "CRITICAL_SEQUENCE_VIOLATIONS"
}
```

**Default gates** (`DEFAULT_CERTIFICATION_CONFIG`):

| Gate | Value | Source |
|---|---|---|
| Accuracy target | 97% (`0.97`) | Spec §2 |
| Max critical sequence violations | 0 | Spec §2 |

Critical sequence codes (violations that count toward the gate):
- `ERR_SEQUENCE_TOTE_BEFORE_ITEM`
- `ERR_SEQUENCE_QTY_BEFORE_ITEM`
- `ERR_SEQUENCE_QTY_MISSING`
- `ERR_SEQUENCE_CTRL_E_TOO_EARLY`
- `ERR_SEQUENCE_CTRL_A_TOO_EARLY`
- `ERR_SEQUENCE_SETUP_INCOMPLETE`

### 8.2 Certification Gate

**File:** `src/sim/certification.ts`

Tracks how many consecutive sessions have passed. Certification is reached when `consecutivePassed >= requiredConsecutive`.

```typescript
CertificationProgress {
  consecutivePassed:   number
  requiredConsecutive: number  // default: 3
  isCertified:         boolean
  lastScores:          ProficiencyScore[]  // last N scores kept
}
```

**Default:** `requiredConsecutive = 3` (matches spec §2 — "≥ 97% over 3 consecutive sessions"). Any failed session resets `consecutivePassed` to 0.

`updateCertificationProgress(prev, score, config?)` is a pure function — it takes the previous progress, a new score, and returns the next progress object. It does not know about sessions, storage, or time.

---

## 9. CLI — Headless Replay Runner

**File:** `src/cli/run-sim.ts`

Replays a pre-authored action sequence against a scenario without requiring a browser. Used for automated testing and batch validation.

**Usage:**

```bash
npm run sim -- --scenario <path> --actions <path> [--trainee <id>] [--session <id>]
```

| Flag | Required | Default | Description |
|---|---|---|---|
| `--scenario` | Yes | — | Path to scenario JSON (validated against `scenario.schema.json`) |
| `--actions` | Yes | — | Path to actions JSON (`{ "actions": AnyEvent[] }`) |
| `--trainee` | No | `"t1"` | Trainee ID string injected into all events |
| `--session` | No | `"s1"` | Session ID string injected into all events |

**Output:** Prints per-event results (accepted / rejected + error code) to stdout, then a session summary. Exits with code 0 on success, non-zero on any schema violation or unhandled error.

All events in the actions file are validated before replay begins. The actions file format is `{ "actions": AnyEvent[] }` — events must be fully typed including `eventId`, `timestamp`, `traineeId`, `sessionId`, and correctly typed `payload`.

---

## 10. UI Layer — ScannerSimulatorV1

### 10.1 Overview

A minimal, framework-free UI component that simulates the physical RF scanner screen a warehouse picker sees. It is intentionally simple: a header bar with four metrics, an instruction area, a text input, a feedback section, and a scan history list.

### 10.2 UI Component Structure (`src/ui/scannerSimulatorV1/`)

| File | Responsibility |
|---|---|
| `mount.ts` | Creates DOM, attaches event listeners, returns a `ScannerSimulatorHandle` |
| `types.ts` | Interface definitions — `ScannerSimViewModel`, `ScannerSimAdapter`, `UiEvent` |
| `engineAdapter.ts` | Adapter factory, UI→Engine mapper, SessionState→ViewModel projector |
| `exampleAdapter.stub.ts` | Reference no-op adapter (not used in the live dev portal) |
| `styles.css` | Component CSS using `rfv1-` prefix convention |

### 10.3 ScannerSimViewModel — What the UI Receives

```typescript
ScannerSimViewModel {
  header: {
    timerText:    string   // "--:--" default (timer not yet implemented)
    progressText: string   // "cursor/totalPicks" e.g. "2/5"
    errorText:    string   // total rejected count
    accuracyText: string   // "75%" or "--" if no attempts
  }
  instructionText:    string         // Current engine state summary e.g. "MODE PICK | BUILD BC_STARTED | PICK PK_AT_LOCATION"
  instructionSubtext?: string        // Optional secondary instruction
  feedback: {
    kind:     "NONE" | "SUCCESS" | "WARNING" | "ERROR"
    code?:    string   // Error code if applicable
    message?: string   // Human-readable message
  }
  lastScanEcho?:  string             // Most recently scanned barcode
  scanHistory?:   readonly string[]  // Up to 3 most recent scans (newest first)
}
```

**Note:** `instructionText` in the current dev adapter is a raw engine state dump (`"MODE PICK | BUILD BC_STARTED | PICK PK_AT_LOCATION"`). This is a dev-only display; it is not a trainee-facing instruction. A proper instructional UI is **[Future Work]**.

### 10.4 UiEvent — What the UI Emits

```typescript
UiEvent = UiScanSubmittedEvent {
  type: "UI_SCAN_SUBMITTED"
  payload: {
    value:       string     // Raw text from the input field (already trimmed)
    timestampMs: number     // ms since epoch
    source:      "keyboard_wedge"
  }
}
```

This is the only event type the UI ever emits. All key command events (`CTRL+A`, `CTRL+E`, etc.) are not yet mapped from the UI — they must currently come from the CLI or direct engine calls.

### 10.5 Input Handling

`mount.ts` attaches a `keydown` listener to the text input. On `Enter`:
1. Trims the value.
2. Clears the input.
3. Creates a `UI_SCAN_SUBMITTED` event.
4. Calls `adapter.mapUiEventToEngineEvents()` → validates → `adapter.applyEngineEvents()` → re-renders.

An auto-focus mechanism (`onBlur` + `onWindowFocus`) keeps the cursor in the input field at all times — matching the behavior of a real RF scanner keyboard wedge that captures all keystrokes.

### 10.6 Feedback Flash

When `feedback.kind` changes (e.g. from `SUCCESS` → `ERROR`), the feedback panel receives a CSS class `rfv1-feedback-flash` for 120ms, creating a brief visual flash to draw attention to state changes.

### 10.7 Default UI→Engine Mapper

`createDefaultUiToEngineMapper()` in `engineAdapter.ts` maps every `UI_SCAN_SUBMITTED` to a single `SCAN_ITEM` engine event. This is intentionally minimal — the mapper is injected into the adapter and can be replaced without touching the UI component. The current mapper does not handle key commands (`CTRL+A`, `CTRL+E`, etc).

---

## 11. Dev Portal

The dev portal is a **developer-only playground**, not a trainee-facing application.

### 11.1 Entry

- Physical file: `dev/scanner/index.html`
- Served at: `http://localhost:3000/dev/scanner` (when using `npx serve .` from repo root)
- The page loads `src/ui/dev/bootstrap.js` as a bare ESM `<script type="module">`.

### 11.2 Route Gate

`src/ui/dev/routes.ts` checks `window.location.pathname`:

```typescript
if (pathname !== "/dev/scanner") {
  return { mounted: false, destroy: () => {} };
}
```

Any other path silently returns an unmounted handle. There is no 404 or redirect.

### 11.3 How It Starts

```
index.html loads bootstrap.js
  → bootstrap() calls mountDevRoutes()
    → mountDevRoutes() checks pathname
      → mountScannerPlayground(host) (if /dev/scanner)
        → fetches /docs/fixtures/scenarios/manifest.json
          → populates fixture selector dropdown
            → loads first fixture as default scenario
              → mounts ScannerSimulatorV1 with the engine adapter wired up
```

### 11.4 Playground UI

The playground adds three panels alongside the scanner component:

| Panel | Contents |
|---|---|
| Fixture dropdown | Lists all fixtures from `manifest.json` by label — switching reloads the scenario |
| ViewModel panel | JSON dump of current `ScannerSimViewModel` (live, updates on every action) |
| Event log panel | JSON dump of last 50 events in `session.eventLog` (live) |

### 11.5 How to Run

```bash
# From geoLMS/ directory:
npx serve .
# Open: http://localhost:3000/dev/scanner
```

`npx http-server .` also works. A bundler is not required. A static file server that sets `Content-Type: application/json` for `.json` files is required for the fixture manifest fetch.

---

## 12. Fixture / Scenario System

### 12.1 Scenario Type

```typescript
Scenario {
  version:        string
  id:             string
  mode:           "guided" | "assisted" | "timed" | "certification"
  rulesetVersion?: string
  seed?:          number   // for future seeded randomness
  buildCart: {
    requiredToteCount: number   // how many SCAN_TOTE_ASSIGN events required
  }
  pickTasks: PickTask[]
}

PickTask {
  pickTaskId:       string
  locationCode:     string
  itemBarcode:      string
  expectedToteSlot: number
  quantityRequired: number
  notes?:           string
}
```

### 12.2 Active Fixtures

All under `docs/fixtures/scenarios/`:

| Filename | Fixture ID | Label | Notes |
|---|---|---|---|
| `scenario.minimal.pick.json` | `scenario.minimal.pick` | Minimal Pick | Simplest happy-path scenario |
| `scenario.two-totes.end-of-tote.json` | `scenario.two-totes.end-of-tote` | Two Totes End Of Tote | Covers `PK_END_OF_TOTE_PENDING` flow |
| `scenario.session.happy.json` | `scenario.session.happy` | Session Happy | Full happy-path session |
| `scenario.invalid.missing-fields.json` | — | (test only) | Intentionally invalid; used in contract validation tests |

### 12.3 Fixture Manifest

Read at runtime by the dev playground from `/docs/fixtures/scenarios/manifest.json`. Validated by `validateFixtureManifest()` in `src/contracts/schema.ts`.

```json
{
  "version": "1.0.0",
  "fixtures": [
    { "id": "...", "label": "...", "scenarioPath": "docs/fixtures/scenarios/..." }
  ]
}
```

---

## 13. Test Suite

### 13.1 Runner

[Vitest](https://vitest.dev/) v3.0. Config: `vitest.config.ts`. No separate jest config.

```bash
npm test              # run all (using vitest.config.ts)
npm run test:watch    # watch mode
npm run lint:contracts # validate JSON contracts with validate-contracts.mjs
npm run ci            # lint:contracts && npm test
```

### 13.2 Test Files

Located in `tests/`. Specs follow a naming convention matching the module they test:

| Spec file | Covers |
|---|---|
| `bootstrap.spec.ts` | `src/ui/dev/bootstrap.ts` — dev portal bootstrap |
| `certification.spec.ts` | `src/sim/certification.ts` |
| `cli.run-sim.spec.ts` | `src/cli/run-sim.ts` |
| `contracts.schema.spec.ts` | `src/contracts/schema.ts` JSON schema validation |
| `contracts.sync.spec.ts` | Contract sync-guard — ensures JSON ↔ TypeScript parity |
| `contracts/events.payload-enforcement.spec.ts` | Per-event-type payload shape enforcement |
| `scenario.schema.spec.ts` | Scenario schema validation (valid + invalid fixtures) |
| `scoring.spec.ts` | `scoreSession()` — pass/fail logic |
| `session.metrics.spec.ts` | `computeMetrics()` |
| `session.replay.spec.ts` | Full session replay via `applyAction()` |
| `state-machines.buildCart.spec.ts` | Build Cart state machine all transitions |
| `state-machines.exceptions.spec.ts` | Exceptions reducer (CTRL+W, CTRL+K, etc.) |
| `state-machines.pick.spec.ts` | Pick state machine all transitions + rejection codes |
| `scannerPlayground.route.spec.ts` | Dev portal route gate (`/dev/scanner` path check) |
| `qa/vitest-exclude-guard.spec.ts` | Verifies that `TEMP_EXCLUDES` in `vitest.config.ts` still point to files that exist (guard against stale excludes) |

### 13.3 Temporarily Excluded Specs

Two specs are excluded from the Vitest run via `vitest.config.ts` (`TEMP_EXCLUDES`):

```
tests/ui/scannerSimulatorV1.spec.ts
tests/ui/scannerSimulatorV1.engineAdapter.spec.ts
```

**Reason:** jsdom worker startup crash caused by `html-encoding-sniffer` / `@exodus/bytes` ESM/CJS incompatibility in the Vitest 3.x worker. These specs exist and are maintained, but **do not run in CI**. The `vitest-exclude-guard.spec.ts` file ensures the exclusion does not silently rot if the spec paths change.

---

## 14. Build & Tooling

### 14.1 npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `build` | `tsc -p tsconfig.json` | Compile all `.ts` → `.js` |
| `sim` | `npx tsx src/cli/run-sim.ts` | Run CLI simulator (without pre-compile) |
| `test` | `vitest run --config vitest.config.ts` | One-shot test run |
| `test:watch` | `vitest` | Watch mode |
| `lint:contracts` | `node scripts/validate-contracts.mjs` | Validate JSON contracts |
| `ci` | `lint:contracts && test` | Full CI pipeline |

### 14.2 TypeScript Configuration

`tsconfig.json` governs compilation. Key characteristics inferred from source:
- Module: ESM (`"type": "module"` in `package.json`)
- Target: modern (uses `const`, `as const`, optional chaining, `Object.freeze`)
- Strict mode enforced
- JSON imports use `assert { type: "json" }` syntax (import assertions)

### 14.3 devDependencies (from `package.json`)

| Package | Version | Role |
|---|---|---|
| `typescript` | ^5.8.2 | Compiler |
| `vitest` | ^3.0.8 | Test runner |
| `ajv` | ^8.17.1 | JSON Schema 2020-12 validation |
| `ajv-formats` | ^3.0.1 | Additional format validators (date-time, etc.) |
| `jsdom` | ^28.1.0 | DOM environment for UI tests |
| `@types/node` | ^22.13.10 | Node.js type definitions |

### 14.4 No Bundler

There is no Vite, Webpack, Rollup, or esbuild configuration. The browser dev portal serves raw TypeScript-compiled `.js` ESM files. The compiled `.js` and `.js.map` files are committed to the repository alongside their `.ts` sources.

---

## 15. What Is Not Yet Built

The following capabilities are referenced in the spec or guardrails but are **not present in this codebase**:

| Capability | Status | Notes |
|---|---|---|
| Backend / persistence | Not present | No database, API, or auth. `traineeId`/`sessionId` exist in events only. |
| Production bundler + deployment | Not present | Dev portal only. No production build artifact. |
| LMS curriculum structure (tracks, modules, activities) | Not present | Spec §7 defines curriculum; no LMS scaffolding implemented. |
| Key command UI inputs (CTRL+A, CTRL+E, CTRL+W, CTRL+K) | Not mapped | Current UI adapter maps all scans to `SCAN_ITEM` only. Key commands require direct CLI or test injection. |
| Trainee-facing instructional text | Not present | `instructionText` currently shows raw engine state dump (dev-only). |
| Speed gate in certification | Not present | `DEFAULT_CERTIFICATION_CONFIG` has no speed field. |
| Workflow prose docs | Empty stubs | `docs/Workflows/build-cart.md`, `pick.md`, `exceptions.md` are all empty. |
| Zone code format validation | Not present | `RF_ZONE_SELECTED.zoneOrTaskGroupCode` is an unvalidated free string. |
| Seeded randomness | Not present | `Scenario.seed` field exists in type but no seed-based logic implemented. |
| Multi-session progress tracking | Not present | `CertificationProgress` is a pure in-memory value; no session history stored. |
| Guided / timed / certification scenario modes | Partially | `ScenarioMode` type exists; mode field is in fixture JSON but engine does not branch on mode yet. |

---

## 16. Dependency Map

```
docs/contracts/events.schema.json ──────────────────────────────┐
docs/contracts/errors.json ─────────────────────────────────────┤
                                                                 │ (runtime sync-guard)
src/contracts/events.ts ◄───────────────────────────────────────┘
src/contracts/errors.ts ◄───────────────────────────────────────┘
src/contracts/schema.ts   (ajv, events.schema.json)

docs/contracts/scenario.schema.json ────► src/sim/scenario.ts (ajv)

src/contracts/* ──────────────────────────► src/sim/state-machines/*.ts
                                            src/sim/router.ts
                                            src/sim/session.ts
                                            src/sim/scoring.ts
                                            src/sim/metrics.ts
                                            src/sim/certification.ts

src/sim/* ────────────────────────────────► src/ui/scannerSimulatorV1/engineAdapter.ts
                                            src/cli/run-sim.ts

src/ui/scannerSimulatorV1/engineAdapter.ts ► src/ui/dev/scannerPlayground.ts
src/ui/scannerSimulatorV1/mount.ts ─────────► src/ui/dev/scannerPlayground.ts
src/ui/dev/scannerPlayground.ts ────────────► src/ui/dev/routes.ts
src/ui/dev/routes.ts ───────────────────────► src/ui/dev/bootstrap.ts
src/ui/dev/bootstrap.ts ────────────────────► dev/scanner/index.html (ESM <script>)

docs/fixtures/scenarios/manifest.json ─────► src/ui/dev/scannerPlayground.ts (runtime fetch)
docs/fixtures/scenarios/*.json ─────────────► src/ui/dev/scannerPlayground.ts (runtime fetch)
                                            src/cli/run-sim.ts (--scenario flag)
```

---

*Last updated: 2026-02-22*
