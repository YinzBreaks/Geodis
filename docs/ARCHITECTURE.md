# GEODIS Picker Simulator — Repository Architecture Overview

> **Doc authority:** This document describes only what is present in the repository as of the last commit.
> Where a design intent extends beyond current code, it is labeled **[Future Work]** or **[Open Question]**.
> SSoT wins over narrative. If this document ever conflicts with `docs/contracts/*` or the TypeScript source, the contracts and source win.

---

## 0. Authoritative Hierarchy

```
docs/contracts/events.schema.json   ← highest authority
docs/contracts/errors.json          ← highest authority
src/sim/state-machines/*.ts         ← workflow sequencing authority
docs/geodis-picker-training-spec.md ← specification (v2)
This document                       ← description only; not prescriptive
```

---

## 1. Repository Layout (Current State)

```
geoLMS/
├── dev/
│   └── scanner/
│       └── index.html              ← dev browser entry; served at /dev/scanner
├── docs/
│   ├── geodis-picker-training-spec.md   ← spec v2 (populated)
│   ├── geodis-picker-lms-constitution.md ← EMPTY (placeholder only)
│   ├── prompt-contect-anchor.md         ← AI context template
│   ├── AI/
│   │   ├── assistant-guardrails.md      ← populated
│   │   ├── roles-and-routing.md         ← populated
│   │   ├── context-bootstrap.md         ← EMPTY
│   │   ├── development-standards.md     ← EMPTY
│   │   ├── project-instructions-for-chatgpt.md ← EMPTY
│   │   └── security-standards.md
│   ├── contracts/
│   │   ├── events.schema.json      ← SSoT event schema (populated, 278 lines)
│   │   ├── errors.json             ← SSoT error codes (19 codes, v2)
│   │   ├── scenario.schema.json    ← scenario validation schema
│   │   └── README.md               ← EMPTY
│   ├── fixtures/
│   │   └── scenarios/
│   │       ├── manifest.json       ← 3 active fixtures
│   │       ├── scenario.minimal.pick.json
│   │       ├── scenario.two-totes.end-of-tote.json
│   │       ├── scenario.session.happy.json
│   │       └── scenario.invalid.missing-fields.json  (intentionally invalid for tests)
│   ├── QA/
│   │   └── acceptance-checklist.md
│   ├── UI/
│   │   └── scanner-simulator-v1.md
│   └── Workflows/
│       ├── build-cart.md           ← EMPTY (sequencing lives in code, not here)
│       ├── pick.md                 ← EMPTY (sequencing lives in code, not here)
│       ├── exceptions.md           ← EMPTY (sequencing lives in code, not here)
│       └── README.md               ← EMPTY
├── src/
│   ├── cli/
│   │   └── run-sim.ts              ← headless CLI runner
│   ├── contracts/
│   │   ├── events.ts               ← CANONICAL_EVENT_TYPES, EventType, payload map
│   │   ├── errors.ts               ← CANONICAL_ERROR_CODES, ErrorCode
│   │   ├── schema.ts               ← ajv-based JSON Schema validator
│   │   └── index.ts                ← re-exports
│   ├── sim/
│   │   ├── router.ts               ← applyAction() — central state dispatch
│   │   ├── session.ts              ← SessionState, createSession()
│   │   ├── scenario.ts             ← Scenario type + JSON validation
│   │   ├── metrics.ts              ← DerivedMetrics, computeMetrics()
│   │   ├── scoring.ts              ← scoreSession(), ProficiencyScore
│   │   ├── certification.ts        ← updateCertificationProgress() (3-session gate)
│   │   ├── emit.ts                 ← emitMany() helper
│   │   ├── types.ts                ← EmittedResult
│   │   ├── validate.ts             ← validateEvent wrappers
│   │   ├── index.ts                ← re-exports
│   │   └── state-machines/
│   │       ├── buildCart.ts        ← Build Cart state machine (WI 5.1)
│   │       ├── pick.ts             ← Pick state machine (WI 5.2)
│   │       └── exceptions.ts       ← Exception dispatcher (WI 6.x)
│   └── ui/
│       ├── dev/
│       │   ├── bootstrap.ts        ← ESM entry, calls mountDevRoutes()
│       │   ├── routes.ts           ← pathname gate: /dev/scanner only
│       │   └── scannerPlayground.ts ← fixture loader + UI wiring
│       └── scannerSimulatorV1/
│           ├── engineAdapter.ts    ← adapter boundary (UI ↔ engine)
│           ├── mount.ts            ← DOM mount function
│           ├── types.ts            ← ScannerSimViewModel, ScannerSimAdapter, UiEvent
│           ├── exampleAdapter.stub.ts
│           └── styles.css
├── tests/                          ← Vitest specs (see §6)
├── scripts/
│   └── validate-contracts.mjs     ← contract lint script
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

> Every `.ts` file has a compiled `.js` sibling committed alongside it (dual-file pattern — no bundler required for dev serving).

---

## 2. Engine Architecture

### 2.1 Overview

The simulator engine is **pure TypeScript, no UI framework**. It is driven by dispatching `AnyEvent` objects through a central function and returns a new immutable `SessionState`. There is no global store, no framework reactivity, and no side effects inside the engine.

```
UiEvent
   │
   ▼
engineAdapter.mapUiEventToEngineEvents()
   │  ← maps raw UI gestures to schema-validated AnyEvent objects
   ▼
applyAction(session, engineEvent)   ← src/sim/router.ts
   │  ← delegates to buildCartReducer OR pickReducer
   ▼
SessionState (new, immutable copy)
   │  ← eventLog appended; metrics recomputed
   ▼
createSessionViewModel(session)     ← src/ui/scannerSimulatorV1/engineAdapter.ts
   │  ← render-only projection; no logic
   ▼
ScannerSimulatorV1 UI re-render
```

### 2.2 Session State

File: `src/sim/session.ts`

`SessionState` has two modes:

| Mode | When active |
|------|-------------|
| `"buildCart"` | Start of every session until `BC_STARTED` |
| `"pick"` | After Build Cart completes (`BC_STARTED` status) |

There is **no third "exceptions" mode**. Exception events (`EXCEPTION_*`) are dispatched within the existing `buildCart` or `pick` state machines via the exceptions dispatcher in `src/sim/state-machines/exceptions.ts`.

Key fields:

```typescript
SessionState {
  mode: "buildCart" | "pick"
  scenarioId, traineeId, sessionId
  scenario: Scenario            // loaded from fixture JSON
  buildCart: { state, config }  // config.requiredToteCount from scenario
  pick: { state, cursor, activePickTaskId, endOfTotePending }
  eventLog: readonly AnyEvent[] // append-only; source of truth for scoring
  metrics: DerivedMetrics       // computed live from eventLog
}
```

### 2.3 State Machines

#### Build Cart (`src/sim/state-machines/buildCart.ts`)

Reference: WI 5.1. States:

```
BC_IDLE → BC_LOGGED_IN → BC_PROGRAM_SELECTED → BC_PHASE_SELECTED
       → BC_TASK_GROUP_MODE → BC_ZONE_SELECTED → BC_MAKE_TOTE_CART_SELECTED
       → BC_CART_SCANNED → BC_TOTES_ASSIGNING → BC_READY_TO_START → BC_STARTED
```

`BC_STARTED` triggers session mode transition to `"pick"`.

#### Pick (`src/sim/state-machines/pick.ts`)

Reference: WI 5.2. States:

```
PK_IDLE → PK_LOGGED_IN → PK_PROGRAM_SELECTED → PK_PHASE_SELECTED
        → PK_TASK_ACTIVE → PK_AT_LOCATION → PK_ITEM_SCANNED
        → PK_QTY_ENTERED → PK_TOTE_VERIFIED → PK_END_OF_TOTE_PENDING
        → PK_TOTE_CONFIRMED → PK_TOTE_CONVEYED
```

The `cursor` in `SessionState.pick` advances after a `SCAN_TOTE_VERIFY` accepted event, moving to the next `PickTask` in `scenario.pickTasks`.

#### Exceptions (`src/sim/state-machines/exceptions.ts`)

Reference: WI 6.x. Not a separate session mode. Maps `EXCEPTION_*` event types to `ErrorCode`:

| Event | Error Code |
|---|---|
| `EXCEPTION_TOTE_ALLOCATED` | `ERR_TOTE_ALREADY_ALLOCATED` |
| `EXCEPTION_CART_ALREADY_CREATED` | `ERR_CART_ALREADY_CREATED` |
| `EXCEPTION_SHORT_INVENTORY` | `ERR_SHORT_INVENTORY` |
| `EXCEPTION_DAMAGED_ITEM` | `ERR_DAMAGED_ITEM` |
| `EXCEPTION_INVALID_ITEM_LAST` | `ERR_INVALID_ITEM` |
| `EXCEPTION_INVALID_ITEM_NOT_LAST` | `ERR_INVALID_ITEM` |

---

## 3. Contracts Layer

### 3.1 Canonical Event Types

File: `src/contracts/events.ts`  
SSoT: `docs/contracts/events.schema.json`

The file exports `EVENT_TYPES` as a frozen `readonly` array. At module load, `ensureCanonicalEventTypes()` compares the hardcoded `CANONICAL_EVENT_TYPES` tuple against the `$defs.eventType.enum` from the JSON schema. If they diverge, the process throws immediately.

31 event types across 5 categories: RF/Navigation, Build Cart, Pick, Exceptions, Outcomes.

### 3.2 Canonical Error Codes

File: `src/contracts/errors.ts`  
SSoT: `docs/contracts/errors.json`

Same sync-guard pattern. 19 error codes across 3 categories: Sequence Errors, Validation Errors, Operational Exceptions.

### 3.3 Schema Validation

File: `src/contracts/schema.ts`

All events are validated with `ajv` + `ajv-formats` against `docs/contracts/events.schema.json`. Every event emitted by a state machine is validated before being committed to the event log (`validateEmittedEventsOrThrow` in `src/sim/router.ts`). An invalid emitted event is a hard throw, not a soft rejection.

---

## 4. UI Layer

### 4.1 Adapter Boundary (Non-Negotiable)

The UI knows nothing about the engine except through the `ScannerSimAdapter` interface (`src/ui/scannerSimulatorV1/types.ts`). The adapter is the only place where:

- `UiEvent` → `AnyEvent[]` mapping occurs
- `applyAction` is called
- `SessionState` → `ScannerSimViewModel` projection occurs

The UI component (`scannerSimulatorV1`) receives only a `ScannerSimViewModel` and emits only `UiEvent`. It contains **no workflow logic**.

### 4.2 ScannerSimulatorV1

Files: `src/ui/scannerSimulatorV1/`

| File | Role |
|---|---|
| `mount.ts` | Framework-agnostic DOM mount; returns a `ScannerSimulatorHandle` |
| `engineAdapter.ts` | `createEngineScannerSimAdapter()` — wires session state ↔ UI |
| `types.ts` | `ScannerSimViewModel`, `ScannerSimAdapter`, `UiEvent` interfaces |
| `exampleAdapter.stub.ts` | Reference stub; not active in production path |
| `styles.css` | Component CSS |

### 4.3 Dev Portal

The dev browser environment is **not a production application**. It is a developer playground for manual testing.

| Component | Path |
|---|---|
| Entry HTML | `dev/scanner/index.html` |
| URL gate | `window.location.pathname === "/dev/scanner"` (or trailing slash) |
| Bootstrap module | `src/ui/dev/bootstrap.ts` |
| Route mount | `src/ui/dev/routes.ts` — creates `[data-testid="dev-scanner-route-host"]` |
| Playground wiring | `src/ui/dev/scannerPlayground.ts` |
| Fixture manifest | Fetched from `/docs/fixtures/scenarios/manifest.json` at runtime |

**To run the dev portal:**

```bash
# From repo root (geoLMS/)
npx serve .
# Open: http://localhost:3000/dev/scanner
```

No bundler is required. The browser loads bare ESM modules directly. `Content-Type: application/json` must be served correctly for `.json` imports — `npx serve` handles this. `npx http-server` also works.

---

## 5. Scenario / Fixture System

**Scenario type** (`src/sim/scenario.ts`):

```typescript
Scenario {
  version: string
  id: string
  mode: "guided" | "assisted" | "timed" | "certification"
  rulesetVersion?: string
  seed?: number
  buildCart: { requiredToteCount: number }
  pickTasks: PickTask[]
}

PickTask {
  pickTaskId, locationCode, itemBarcode
  expectedToteSlot: number
  quantityRequired: number
  notes?: string
}
```

Active fixtures in `docs/fixtures/scenarios/`:

| ID | Label |
|---|---|
| `scenario.minimal.pick` | Minimal Pick |
| `scenario.two-totes.end-of-tote` | Two Totes End Of Tote |
| `scenario.session.happy` | Session Happy |

`scenario.invalid.missing-fields.json` is intentionally invalid and used in contract/validation tests.

---

## 6. Scoring and Certification

### Scoring (`src/sim/scoring.ts`)

`scoreSession(eventLog, config?)` computes a `ProficiencyScore`:

```typescript
ProficiencyScore {
  pickAccuracy: number          // accepted pick actions / total pick actions
  totalRejected: number
  criticalSequenceViolations: number
  rejectedByError: Record<ErrorCode, number>
  passed: boolean
  reasons: readonly string[]
}
```

Default gate (from spec §2):
- `accuracyTarget: 0.97` (97%)
- `maxCriticalSequenceViolations: 0`

### Certification (`src/sim/certification.ts`)

`updateCertificationProgress(prev, score, config?)` tracks consecutive passing sessions.

Default gate: `requiredConsecutive: 3` (matches spec §2 — "3 consecutive sessions").

`isCertified` becomes `true` when `consecutivePassed >= requiredConsecutive`.

---

## 7. CLI

File: `src/cli/run-sim.ts`

Headless scenario replay for automated testing or batch runs.

```bash
npm run sim -- --scenario <path> --actions <path> [--trainee <id>] [--session <id>]
```

Arguments:
- `--scenario` — path to a scenario JSON file (validated against `scenario.schema.json`)
- `--actions` — path to an actions JSON file containing `{ "actions": AnyEvent[] }`
- `--trainee` — trainee ID string (default: `"t1"`)
- `--session` — session ID string (default: `"s1"`)

Exits non-zero on schema violation or invalid transition.

---

## 8. Test Suite

Runner: **Vitest** (no test framework/DOM wrapper beyond jsdom for UI tests).

```bash
npm test          # run all (respects vitest.config.ts excludes)
npm run test:watch
npm run lint:contracts   # validate events.schema.json + errors.json
npm run ci        # lint:contracts && test
```

### Temp-excluded specs

`vitest.config.ts` TEMP excludes two specs due to an upstream `html-encoding-sniffer`/`@exodus/bytes` ESM/CJS worker crash in jsdom startup:

```
tests/ui/scannerSimulatorV1.spec.ts
tests/ui/scannerSimulatorV1.engineAdapter.spec.ts
```

These are **not passing in CI**. This exclusion must be removed once the upstream ESM compatibility issue is resolved. See `TEMP_EXCLUDES` in `vitest.config.ts`.

---

## 9. Build

```bash
npm install       # install devDependencies (TypeScript, Vitest, ajv, jsdom)
npm run build     # tsc — compiles all .ts → .js
```

- No bundler (Vite, Webpack, Rollup, esbuild) is configured.
- Compiled `.js` files are committed alongside `.ts` files. This is intentional for the current dev-serving approach.
- There is no production build artifact or deployment pipeline.

---

## 10. Drift Check

> Statements that were corrected because they conflicted with code or SSoT.

| # | Claim | Correction |
|---|---|---|
| D-1 | `docs/Workflows/build-cart.md`, `pick.md`, `exceptions.md` document workflow sequencing | All three files are **empty**. The authoritative workflow sequencing lives exclusively in `src/sim/state-machines/buildCart.ts`, `pick.ts`, and `exceptions.ts`. The workflow docs are unfilled stubs. |
| D-2 | `docs/geodis-picker-lms-constitution.md` is a constitutional document | The file **exists but is empty**. It is not an active SSoT. |
| D-3 | `docs/AI/development-standards.md` and `context-bootstrap.md` define AI standards | Both files are **empty**. Active AI guardrails are in `docs/AI/assistant-guardrails.md` and `docs/AI/roles-and-routing.md`. |
| D-4 | Exceptions are handled in a separate session mode | There is **no "exceptions" mode** in `SessionState`. Exception handling is dispatched within the `buildCart`/`pick` state machines via `EXCEPTION_*` event types, and the `exceptions.ts` reducer maps them to error codes. |
| D-5 | Trainee profiles and session history are persisted | There is **no backend persistence** in this repo. `traineeId` and `sessionId` exist in event payloads and `SessionState`, but there is no database, no API, and no storage layer. |
| D-6 | Two UI test specs are passing in CI | `tests/ui/scannerSimulatorV1.spec.ts` and `tests/ui/scannerSimulatorV1.engineAdapter.spec.ts` are **temporarily excluded** from Vitest due to a jsdom/ESM worker crash (`vitest.config.ts`: `TEMP_EXCLUDES`). They do not run in CI. |
| D-7 | The dev application is bundled | There is **no bundler**. The browser dev portal runs as raw unbundled ESM served via `npx serve`. |
| D-8 | The dev entry point URL is unspecified | The route gate in `src/ui/dev/routes.ts` checks exactly `window.location.pathname === "/dev/scanner"`. Any other path returns `{ mounted: false }`. The physical HTML file is `dev/scanner/index.html`. |
| D-9 | `docs/contracts/README.md` describes contracts | This file is **empty**. |

---

## 11. Open Questions

> Living section. Unknowns must remain configurable defaults, not hard-coded assumptions.

| # | Question | Current handling |
|---|---|---|
| OQ-1 | When will `docs/Workflows/build-cart.md`, `pick.md`, and `exceptions.md` be populated with prose workflow specs? | Sequencing currently lives only in TypeScript state machines. These docs are scaffolded but empty. |
| OQ-2 | Is tote count fixed or dynamic per task group? | `requiredToteCount` is per-scenario in the fixture JSON. No site default established. |
| OQ-3 | How are zone codes standardized across facilities? | Zone codes appear in `RF_ZONE_SELECTED` payload as `zoneOrTaskGroupCode` (string). No validation format defined. |
| OQ-4 | Is quantity entry always manual? | Enforced as a required step (`ENTER_QUANTITY` before `SCAN_TOTE_VERIFY`). No override path exists. |
| OQ-5 | When exactly does "End Of Tote" trigger in production? | `PK_END_OF_TOTE_PENDING` is set when the pick state machine enters that status. No production timing mapped. |
| OQ-6 | What are official speed benchmarks per site? | `DEFAULT_CERTIFICATION_CONFIG` does not include a speed gate. Speed targets are a **[Future Work]** config field. |
| OQ-7 | Will a backend (persistence, auth, trainee records) be added? | Not present. Would require a separate service and API contract. **[Future Work]** |
| OQ-8 | Will a production bundler and deployment pipeline be added? | Not present. **[Future Work]** |
| OQ-9 | When will the two excluded UI specs be unblocked? | Blocked on upstream `html-encoding-sniffer`/`@exodus/bytes` ESM/CJS compat fix. See `vitest.config.ts`. |
| OQ-10 | Will `docs/geodis-picker-lms-constitution.md` and the empty AI docs be populated? | Currently empty scaffolds. Intended but not written. |

---

## 12. Versioning

Spec version: v2 (aligned to BBWD-WI-030, 01/06/2025 revision)  
Architecture doc last updated: 2026-02-22  

Any behavioral change requires, in order:
1. Contract update (if event/error changes)
2. Workflow document update
3. Test update
4. Acceptance checklist validation
5. Role + model declaration in the proposal

No undocumented behavior is permitted.
