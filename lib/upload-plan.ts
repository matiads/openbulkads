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

// Suggested names for new structure are prefilled in the form; a run plan only keeps
// the ones it will actually create, so history shows real names for existing structure.
export function plannedStructureNames(
  placement: Placement,
  names: { campaignName: string; adsetName: string },
): { campaignName?: string; adsetName?: string } {
  if (placement === "campaign") return names;
  if (placement === "adset") return { adsetName: names.adsetName };
  return {};
}
