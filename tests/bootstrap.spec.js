import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ui/dev/routes.js", () => ({
    mountDevRoutes: vi.fn()
}));

import { bootstrap } from "../src/ui/dev/bootstrap.js";
import { mountDevRoutes } from "../src/ui/dev/routes.js";

describe("bootstrap", () => {
    beforeEach(() => {
        mountDevRoutes.mockReset();
        mountDevRoutes.mockResolvedValue({ mounted: false, destroy: () => {} });
    });
    it("passes the injected document to mountDevRoutes", async () => {
        const fakeDocument = {
            defaultView: { location: { pathname: "/" } }
        };
        await bootstrap(fakeDocument);
        expect(mountDevRoutes).toHaveBeenCalledOnce();
        expect(mountDevRoutes).toHaveBeenCalledWith(fakeDocument);
    });
    it("returns void (resolves to undefined) regardless of route match", async () => {
        const fakeDocument = {
            defaultView: { location: { pathname: "/dev/scanner" } }
        };
        mountDevRoutes.mockResolvedValueOnce({ mounted: true, destroy: () => {} });
        await expect(bootstrap(fakeDocument)).resolves.toBeUndefined();
    });
    it("module-level auto-run does not fire in Node (window guard is inert)", () => {
        expect(mountDevRoutes).not.toHaveBeenCalled();
    });
});
