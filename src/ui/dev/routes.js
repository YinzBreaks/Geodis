import { mountScannerPlayground } from "./scannerPlayground.js";
export async function mountDevRoutes(documentRef = document) {
    if (documentRef.defaultView?.location.pathname !== "/dev/scanner") {
        return {
            mounted: false,
            destroy: () => { }
        };
    }
    let host = documentRef.querySelector("[data-testid='dev-scanner-route-host']");
    if (!host) {
        host = documentRef.createElement("div");
        host.setAttribute("data-testid", "dev-scanner-route-host");
        documentRef.body.appendChild(host);
    }
    const playgroundHandle = await mountScannerPlayground(host);
    return {
        mounted: true,
        destroy: () => {
            playgroundHandle.destroy();
            if (host && host.parentNode) {
                host.parentNode.removeChild(host);
            }
        }
    };
}
