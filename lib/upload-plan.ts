export type Placement = "ads" | "adset" | "campaign";
export type Distribution = "single" | "round-robin" | "manual";

export function targetSetId(input: {
  placement: Placement;
  distribution: Distribution;
  baseAdset: string;
  selectedAdsets: string[];
  manualAdset?: string;
  index: number;
}) {
  if (input.placement !== "ads" || input.distribution === "single")
    return input.baseAdset;
  if (input.distribution === "manual") return input.manualAdset || "";
  if (!input.selectedAdsets.length) return "";
  return input.selectedAdsets[input.index % input.selectedAdsets.length];
}
