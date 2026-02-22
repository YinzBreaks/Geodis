import { validateFixtureManifest } from "../../contracts/schema.js";
import { createDefaultUiToEngineMapper, createSessionViewModel, createEngineScannerSimAdapter } from "../scannerSimulatorV1/engineAdapter.js";
import { mountScannerSimulatorV1 } from "../scannerSimulatorV1/mount.js";
import { applyAction } from "../../sim/router.js";
import { createSession } from "../../sim/session.js";
const FIXTURE_MANIFEST_PATH = "/docs/fixtures/scenarios/manifest.json";
const EVENT_LOG_LIMIT = 50;
async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
    }
    return response.json();
}
async function defaultLoadManifest(manifestPath) {
    const payload = await fetchJson(manifestPath);
    const result = validateFixtureManifest(payload);
    if (!result.ok) {
        throw new Error(`Invalid fixture manifest at ${manifestPath}: ${(result.errors ?? []).join(" | ")}`);
    }
    return payload;
}
async function defaultLoadFixtureScenario(fixture) {
    const payload = await fetchJson(`/${fixture.scenarioPath}`);
    return payload;
}
function createLayout(host) {
    host.innerHTML = `
    <section data-testid="playground-root">
      <h2>Simulator Playground</h2>
      <label>
        Fixture
        <select data-testid="playground-fixture"></select>
      </label>
      <div data-testid="playground-scanner"></div>
      <section>
        <h3>ViewModel</h3>
        <pre data-testid="playground-view-model"></pre>
      </section>
      <section>
        <h3>Event Log</h3>
        <pre data-testid="playground-event-log"></pre>
      </section>
    </section>
  `;
    return {
        selector: host.querySelector("[data-testid='playground-fixture']"),
        scannerHost: host.querySelector("[data-testid='playground-scanner']"),
        viewModelPanel: host.querySelector("[data-testid='playground-view-model']"),
        eventLogPanel: host.querySelector("[data-testid='playground-event-log']")
    };
}
export async function mountScannerPlayground(host, options = {}) {
    const manifestPath = options.manifestPath ?? FIXTURE_MANIFEST_PATH;
    const loadManifest = options.loadManifest ?? defaultLoadManifest;
    const loadFixtureScenario = options.loadFixtureScenario ?? defaultLoadFixtureScenario;
    const now = options.now ?? (() => Date.now());
    const refs = createLayout(host);
    const manifest = options.manifest ?? await loadManifest(manifestPath);
    refs.selector.replaceChildren(...manifest.fixtures.map((fixture) => {
        const option = host.ownerDocument.createElement("option");
        option.value = fixture.id;
        option.textContent = fixture.label;
        return option;
    }));
    let scannerHandle = null;
    let adapterRef = null;
    let eventSeq = 0;
    let session = null;
    const updateDebugPanels = () => {
        if (!session || !adapterRef) {
            refs.viewModelPanel.textContent = "{}";
            refs.eventLogPanel.textContent = "[]";
            return;
        }
        // ViewModel comes from the adapter — UI never interprets engine state directly.
        const viewModel = adapterRef.getViewModel();
        refs.viewModelPanel.textContent = JSON.stringify(viewModel, null, 2);
        refs.eventLogPanel.textContent = JSON.stringify(session.eventLog.slice(-EVENT_LOG_LIMIT), null, 2);
    };
    const mountFixture = async (fixtureId) => {
        const fixture = manifest.fixtures.find((entry) => entry.id === fixtureId);
        if (!fixture) {
            throw new Error(`Unknown fixture id: ${fixtureId}`);
        }
        const scenario = await loadFixtureScenario(fixture);
        eventSeq = 0;
        session = createSession(scenario, {
            traineeId: "dev-trainee",
            sessionId: `dev-session-${fixture.id}`
        });
        // UI→engine mapping lives entirely in the adapter layer.
        const mapper = createDefaultUiToEngineMapper(
            () => `dev-${fixture.id}-${(eventSeq += 1).toString().padStart(4, "0")}`
        );
        const adapter = createEngineScannerSimAdapter({
            getSessionState: () => {
                if (!session) {
                    throw new Error("Session is not initialized");
                }
                return session;
            },
            setSessionState: (next) => {
                session = next;
                updateDebugPanels();
            },
            mapUiEventToEngineEvents: mapper,
            applyActionToSession: (activeSession, event) => applyAction(activeSession, event),
            toViewModel: (activeSession, defaults) => createSessionViewModel(activeSession, defaults)
        });
        adapterRef = adapter;
        scannerHandle?.destroy();
        scannerHandle = mountScannerSimulatorV1(refs.scannerHost, adapter, { now });
        updateDebugPanels();
    };
    const onFixtureChange = () => {
        void mountFixture(refs.selector.value);
    };
    refs.selector.addEventListener("change", onFixtureChange);
    await mountFixture(manifest.fixtures[0]?.id ?? "");
    return {
        destroy: () => {
            refs.selector.removeEventListener("change", onFixtureChange);
            scannerHandle?.destroy();
            host.innerHTML = "";
        }
    };
}
