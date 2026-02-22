import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import eventsSchemaDocument from "../../docs/contracts/events.schema.json";
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validator = ajv.compile(eventsSchemaDocument);
export function validateEvent(event) {
    const ok = validator(event);
    if (ok) {
        return { ok: true };
    }
    const errors = (validator.errors ?? []).map((error) => {
        const path = error.instancePath || "root";
        return `${path} ${error.message ?? "validation error"}`;
    });
    return { ok: false, errors };
}

// Fixture manifest schema — kept co-located with event validation to avoid drift.
const FIXTURE_MANIFEST_SCHEMA = {
    type: "object",
    required: ["version", "fixtures"],
    additionalProperties: false,
    properties: {
        version: { type: "string", minLength: 1 },
        fixtures: {
            type: "array",
            minItems: 1,
            items: {
                type: "object",
                required: ["id", "label", "scenarioPath"],
                additionalProperties: false,
                properties: {
                    id: { type: "string", minLength: 1 },
                    label: { type: "string", minLength: 1 },
                    scenarioPath: { type: "string", minLength: 1 }
                }
            }
        }
    }
};

const manifestValidator = ajv.compile(FIXTURE_MANIFEST_SCHEMA);

export function validateFixtureManifest(value) {
    const ok = manifestValidator(value);
    if (ok) {
        return { ok: true };
    }
    const errors = (manifestValidator.errors ?? []).map((error) => {
        const path = error.instancePath || "root";
        return `${path} ${error.message ?? "validation error"}`;
    });
    return { ok: false, errors };
}
