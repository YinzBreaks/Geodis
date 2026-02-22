import { mountDevRoutes } from "./routes.js";

/**
 * Mounts the dev route for the current page.
 * Accepts an injected document for testability; defaults to the global document.
 * Does nothing except call mountDevRoutes — no extra state, no business logic.
 */
export async function bootstrap(documentRef = document) {
    await mountDevRoutes(documentRef);
}

// Auto-invoke when loaded as a browser ESM module.
// Guarded so this block is inert in Node/Vitest environments.
if (typeof window !== "undefined") {
    const run = () => { void bootstrap(window.document); };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", run);
    } else {
        run();
    }
}
