import { mountScannerPlayground, type ScannerPlaygroundHandle } from "./scannerPlayground.js";

export type DevRouteHandle = {
  mounted: boolean;
  destroy: () => void;
};

export async function mountDevRoutes(documentRef: Document = document): Promise<DevRouteHandle> {
  if (documentRef.defaultView?.location.pathname !== "/dev/scanner") {
    return {
      mounted: false,
      destroy: () => {}
    };
  }

  let host = documentRef.querySelector("[data-testid='dev-scanner-route-host']") as HTMLElement | null;
  if (!host) {
    host = documentRef.createElement("div");
    host.setAttribute("data-testid", "dev-scanner-route-host");
    documentRef.body.appendChild(host);
  }

  const playgroundHandle: ScannerPlaygroundHandle = await mountScannerPlayground(host);

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
