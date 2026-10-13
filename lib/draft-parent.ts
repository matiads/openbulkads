const ALLOWED_PARENT_STATUSES = new Set(["ACTIVE", "PAUSED"]);

export function assertDraftParent(kind: "campaign" | "adset", status: unknown) {
  if (ALLOWED_PARENT_STATUSES.has(String(status))) return;
  const label = kind === "campaign" ? "campaña" : "conjunto";
  throw new Error(`El ${label} de destino está archivado, eliminado o no disponible. Elegí otro.`);
}
