"use client";
import { tokenLabel, tokenDeadline, TokenMetadata } from "@/lib/token-core";
import { canResumeRejectedJob } from "@/lib/media-retry";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, ChevronRight, CircleCheck, Copy, ExternalLink, Folder, History, Image as ImageIcon, Info, Layers, Layers3, Link as LinkIcon, Loader2, PauseCircle, PlusCircle, RefreshCw, Search, Settings2, Trash2, UploadCloud, Video, ChevronsUpDown, type LucideIcon } from "lucide-react";
import { AppIcon } from "@/components/app-icon";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { isAttributionFailure } from "@/lib/attribution-recovery";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy as CopyType, emptyCopy, resolveCopy, supportedFile, driveLines, MAX_ADS } from "@/lib/batch-core";
import { looksLikeLocalFilePath, LOCAL_PATH_DRIVE_MESSAGE } from "@/lib/file-name";
import { buildGroups, GROUPING_MODES, STRUCTURE_LABELS } from "@/lib/campaign-build";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { targetSetId } from "@/lib/upload-plan";
import { mediaLimitMb } from "@/lib/media-limit";
import { clientId } from "@/lib/client-id";
type Item = { id: string; name: string; [k: string]: any };
type Row = {
  nameAuto?: boolean;
  resolvedDrive?: string;
  useCommon: boolean;
  description: string;
  urlTags: string;
  cta: string;
  preview?: string;
  uploadError?: string;
  key: string;
  name: string;
  source: string;
  mediaType: string;
  drive: string;
  uploadKey?: string;
  fileName?: string;
  creative: string;
  message: string;
  title: string;
  link: string;
  group?: string;
};
const fresh = (): Row => ({
  nameAuto: true,
  useCommon: true,
  description: "",
  urlTags: "",
  cta: "",
  key: clientId(),
  name: "",
  source: "drive",
  mediaType: "image",
  drive: "",
  creative: "",
  message: "",
  title: "",
  link: "",
  group: "",
});
const stageLabel: Record<string, string> = {
  prepare: "Descargando archivo",
  upload: "Subiendo a Meta",
  video: "Procesando video",
  creative: "Creando creativo",
  ad: "Creando anuncio",
  verify: "Verificando estado",
  copy_campaign: "Copiando campaña",
  rename: "Nombrando campaña",
  copy_sets: "Copiando conjuntos",
  copy_adset: "Copiando conjunto",
  rename_adset: "Nombrando conjunto",
  rename_copied_set: "Nombrando conjunto",
  verify_adset: "Verificando conjunto",
  verify_template: "Verificando plantilla",
  create_campaign: "Creando campaña",
  create_sets: "Creando conjuntos",
  verify_campaign: "Verificando campaña",
  done: "Completado",
};
type JobRun = { id: string; name: string; created: number; status: string; jobs: any[]; plan?: any };
function groupJobRuns(jobs: any[]): JobRun[] {
  const groups = new Map<string, JobRun>();
  for (const job of jobs) {
    const id = job.payload.runId || job.id;
    const group: JobRun = groups.get(id) || { id, name: job.payload.runName || job.payload.name, created: job.created, status: "done", jobs: [] };
    if (job.kind === "run-plan") group.plan = job;
    else group.jobs.push(job);
    group.created = Math.min(group.created, job.created);
    groups.set(id, group);
  }
  const priority: Record<string, number> = { failed: 6, uncertain: 5, working: 4, waiting: 3, ready: 2, done: 1 };
  for (const group of groups.values()) {
    group.status = group.jobs.length ? group.jobs.reduce((status, job) => (priority[job.status] > priority[status] ? job.status : status), "done") : "ready";
    if (group.plan && group.jobs.length < Number(group.plan.payload.runTotal) && group.status === "done") group.status = "ready";
  }
  return [...groups.values()].sort((a, b) => b.created - a.created);
}
async function api(path: string, options?: RequestInit) {
  const r = await fetch("/api/" + path, {
    ...options,
    headers: {
      ...(options?.body instanceof Blob ? {} : { "Content-Type": "application/json" }),
      ...options?.headers,
    },
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || "No se pudo completar la solicitud.");
  return data;
}
function Picker({ label, value, onChange, items, placeholder, disabled, icon }: { label: string; value: string; onChange: (v: string) => void; items: Item[]; placeholder?: string; disabled?: boolean; icon?: LucideIcon }) {
  return (
    <label className="field">
      <span>{icon && <AppIcon icon={icon} size="secondary" />}{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="picker">
          <SelectValue placeholder={placeholder || "Seleccionar"} />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
              {i.account_status && i.account_status !== 1 ? " · No activa" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
function MetaMark() {
  return <NextImage src="/meta-mark.svg" alt="Meta" width={28} height={19} />;
}
function AccountPicker({ value, onChange, items, disabled, connected }: { value: string; onChange: (value: string) => void; items: Item[]; disabled: boolean; connected: boolean }) {
  const selected = items.find((item) => item.id === value);
  return (
    <label className="field account-picker">
      <span>Cuenta publicitaria <AppIcon icon={Info} size="secondary" /></span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="account-trigger">
          <SelectValue placeholder={connected ? "Elegí una cuenta" : "Conectá Meta para ver tus cuentas"}>
            {selected && <span className="account-value"><span className="meta-mark"><MetaMark /></span><span><strong>{selected.name}</strong><small>ID: {selected.id.replace("act_", "")}</small></span></span>}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => <SelectItem key={item.id} value={item.id}><span className="account-option-value"><MetaMark /><span><strong>{item.name}</strong><small>ID: {item.id.replace("act_", "")}</small></span></span></SelectItem>)}
        </SelectContent>
      </Select>
    </label>
  );
}
function AdThumbnail({ item }: { item: Item }) {
  const thumbnail = item.creative?.thumbnail_url;
  return (
    <span className="ad-thumbnail">
      {thumbnail ? (
        // Meta thumbnails use short-lived remote hosts that cannot be declared statically for next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnail} alt="" />
      ) : <AppIcon icon={ImageIcon} />}
    </span>
  );
}
function EntityRow({ item, selected, icon, thumbnail = false, disabled, onClick }: { item: Item; selected: boolean; icon?: LucideIcon; thumbnail?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`entity-row${selected ? " selected" : ""}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
      {thumbnail ? <AdThumbnail item={item} /> : <span className="entity-icon">{icon && <AppIcon icon={icon} />}</span>}
      <span className="entity-copy"><strong>{item.name}</strong><small>ID: {item.id}</small></span>
      <AppIcon icon={ChevronRight} size="secondary" className="entity-chevron" />
    </button>
  );
}
function FeatureSidebar({ mode, busy, connected, userName, selectFeature, openHistory, openConfig, openConnection }: { mode: "existing" | "template" | "campaign"; busy: boolean; connected: boolean; userName: string; selectFeature: (mode: "existing" | "template" | "campaign") => void; openHistory: () => void; openConfig: () => void; openConnection: () => void }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const run = (action: () => void) => {
    action();
    if (isMobile) setOpenMobile(false);
  };
  return (
    <Sidebar collapsible="icon" className="app-sidebar">
      <SidebarHeader className="sidebar-header">
        <Link className="sidebar-brand" href="/" aria-label="OpenBulkAds">
          <span className="sidebar-brand-mark"><NextImage src="/openbulkads-isologo.png" alt="" width={28} height={28} priority /></span>
          <span className="sidebar-brand-copy"><strong>OpenBulkAds</strong><small>Marketing workspace</small></span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Espacio de trabajo</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton tooltip="Crear anuncios" isActive={mode === "existing"} aria-pressed={mode === "existing"} onClick={() => run(() => selectFeature("existing"))}><AppIcon icon={PlusCircle} /><span>Crear anuncios</span></SidebarMenuButton></SidebarMenuItem>
              <SidebarMenuItem><SidebarMenuButton tooltip="Historial" onClick={() => run(openHistory)}><AppIcon icon={History} /><span>Historial</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Cuenta</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem><SidebarMenuButton tooltip="Configuración" onClick={() => run(openConfig)} disabled={busy}><AppIcon icon={Settings2} /><span>Configuración</span></SidebarMenuButton></SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="sidebar-footer">
        <button className="sidebar-profile" type="button" onClick={() => run(openConnection)} aria-label={connected ? `Cuenta de Meta: ${userName}` : "Conectar cuenta de Meta"}>
          <span className="sidebar-avatar" aria-hidden="true">{connected ? userName.trim().charAt(0).toUpperCase() || "M" : "M"}</span>
          <span className={`sidebar-profile-copy${connected ? "" : " is-offline"}`}><strong>{connected ? userName : "Cuenta de Meta"}</strong><small><AppIcon icon={connected ? CircleCheck : AlertTriangle} size="secondary" />{connected ? "Conectada" : "Sin conectar"}</small></span>
          <AppIcon icon={ChevronsUpDown} size="secondary" className="sidebar-profile-action" />
        </button>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

export default function AdsWorkspace({ nodeRuntime = false }: { nodeRuntime?: boolean }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false),
    [userName, setUserName] = useState(""),
    [connectionOpen, setConnectionOpen] = useState(false),
    [token, setToken] = useState("");
  const [metadata, setMetadata] = useState<TokenMetadata | null>(null),
    [canExtend, setCanExtend] = useState(false),
    // Capture the initial clock outside render; the interval below owns subsequent updates.
    // eslint-disable-next-line react-hooks/purity -- wall-clock display must start at current time.
    [clock, setClock] = useState(Date.now());
  const [configOpen, setConfigOpen] = useState(false),
    [appId, setAppId] = useState("1638631194443006"),
    [appSecret, setAppSecret] = useState(""),
    [hasSecret, setHasSecret] = useState(false),
    [availableAccounts, setAvailableAccounts] = useState<Item[]>([]),
    [chosenAccounts, setChosenAccounts] = useState<string[] | null>(null),
    [accountSearch, setAccountSearch] = useState("");
  const [accounts, setAccounts] = useState<Item[]>([]),
    [campaigns, setCampaigns] = useState<Item[]>([]),
    [sets, setSets] = useState<Item[]>([]),
    [ads, setAds] = useState<Item[]>([]);
  const [account, setAccount] = useState(""),
    [campaign, setCampaign] = useState(""),
    [adset, setAdset] = useState(""),
    [baseAdId, setBaseAdId] = useState(""),
    [mode, setMode] = useState<"existing" | "template" | "campaign">("existing"),
    [newName, setNewName] = useState("");
  const [placement, setPlacement] = useState<"ads" | "adset" | "campaign">("ads"),
    [placementCampaignName, setPlacementCampaignName] = useState(""),
    [placementAdsetName, setPlacementAdsetName] = useState(""),
    [distribution, setDistribution] = useState<"single" | "round-robin" | "manual">("single"),
    [distributionSetIds, setDistributionSetIds] = useState<string[]>([]),
    [newSetStructure, setNewSetStructure] = useState("single");
  const [campaignQuery, setCampaignQuery] = useState(""),
    [adsetQuery, setAdsetQuery] = useState(""),
    [adQuery, setAdQuery] = useState("");
  const [templateSetIds, setTemplateSetIds] = useState<string[]>([]);
  const [page, setPage] = useState(""),
    [instagram, setInstagram] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [jobs, setJobs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [review, setReview] = useState(false),
    [queueProgress, setQueueProgress] = useState(0);
  const [common, setCommon] = useState<CopyType>(emptyCopy),
    [model, setModel] = useState(""),
    [modelInfo, setModelInfo] = useState<any>(null),
    [modelLoading, setModelLoading] = useState(false),
    [adsLoaded, setAdsLoaded] = useState(false),
    [presets, setPresets] = useState<Item[]>([]),
    [preset, setPreset] = useState(""),
    [presetName, setPresetName] = useState(""),
    [presetOpen, setPresetOpen] = useState(false),
    [driveBatch, setDriveBatch] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [dragging, setDragging] = useState(false),
    [uploadProgress, setUploadProgress] = useState("");
  const [build, setBuild] = useState({
    name: "",
    cbo: true,
    budgetType: "daily",
    budgetAmount: "",
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    bidAmount: "",
    adBudgetType: "daily",
    adBudgetAmount: "",
    startTime: "",
    endTime: "",
    countries: "",
    ageMin: "",
    ageMax: "",
    genders: "all",
    structure: "single",
  });
  const [modelCampaign, setModelCampaign] = useState(""),
    [modelAdset, setModelAdset] = useState(""),
    [modelSets, setModelSets] = useState<Item[]>([]),
    [rowAdsets, setRowAdsets] = useState<Record<string, string>>({});
  const rowsRef = useRef<Row[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const [recovery, setRecovery] = useState<any>(null),
    [recoveryLoading, setRecoveryLoading] = useState(false);
  const pendingPreset = useRef<any>(null),
    pendingBuild = useRef<any>(null),
    pendingCreativeModel = useRef<string>(""),
    pendingCampaignHandoff = useRef<any>(null),
    objectUrls = useRef(new Set<string>());
  const generation = useRef({
      account: 0,
      campaign: 0,
      adset: 0,
      model: 0,
      build: 0,
    }),
    stop = useRef(false);
  const templateSets = sets.filter((s) => templateSetIds.includes(s.id));
  const selectedSet = sets.find((s) => s.id === adset),
    selectedCampaign = campaigns.find((c) => c.id === campaign),
    selectedAccount = accounts.find((a) => a.id === account),
    baseAd = ads.find((a) => a.id === baseAdId) || ads.find((a) => a.creative?.id === model);
  const metaAccountId = account.replace("act_", "");
  const metaManagerUrl = !account
    ? ""
    : baseAd
      ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${metaAccountId}&selected_ad_ids=${baseAd.id}`
      : selectedSet
        ? `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${metaAccountId}&selected_adset_ids=${selectedSet.id}`
        : selectedCampaign
          ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${metaAccountId}&selected_campaign_ids=${selectedCampaign.id}`
          : `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${metaAccountId}`;
  const matches = (item: Item, query: string) => `${item.name} ${item.id}`.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es"));
  const visibleCampaigns = campaigns.filter((item) => matches(item, campaignQuery));
  const visibleSets = sets.filter((item) => matches(item, adsetQuery));
  const visibleAds = ads.filter((item) => matches(item, adQuery));
  const jobRuns = groupJobRuns(jobs);
  const targetSet = mode === "campaign" ? modelAdset : adset;
  const buildSource = mode === "campaign" ? modelSets.find((s) => s.id === modelAdset) : null;
  const modelObjective = modelCampaign ? campaigns.find((c) => c.id === modelCampaign)?.objective || "" : "";
  let groups: any[] = [];
  let structureError = "";
  if (mode === "campaign") {
    try {
      groups = buildGroups(
        rows.map((r) => ({ key: r.key, name: r.name, group: r.group })),
        build.structure,
        build.name || "Conjunto principal",
      );
    } catch (e: any) {
      structureError = e.message;
    }
  }
  const groupForRow = (r: Row) => groups.find((g) => g.rowKeys.includes(r.key))?.name || "";
  let placementGroups: any[] = [];
  let placementStructureError = "";
  if (mode === "existing" && placement !== "ads") {
    try {
      placementGroups = buildGroups(rows.map((r) => ({ key: r.key, name: r.name, group: r.group })), newSetStructure, placementAdsetName || "Conjunto nuevo");
    } catch (e: any) {
      placementStructureError = e.message;
    }
  }
  const placementGroupForRow = (row: Row) => placementGroups.find((group) => group.rowKeys.includes(row.key));
  const availableDistributionSets = sets.filter((s) => distributionSetIds.includes(s.id));
  function targetAdsetForRow(row: Row, index: number) {
    return targetSetId({ placement, distribution, baseAdset: adset, selectedAdsets: availableDistributionSets.map((s) => s.id), manualAdset: rowAdsets[row.key], index });
  }
  const distributionLabel = distribution === "manual" ? "Manual por anuncio" : distribution === "round-robin" ? `Automática · ${availableDistributionSets.length} conjunto(s)` : selectedSet?.name || "Conjunto seleccionado";
  function patchBuild(patch: any) {
    setBuild((prev) => ({ ...prev, ...patch }));
  }
  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  async function refreshJobs() {
    try {
      setJobs((await api("jobs")).data);
    } catch {}
  }
  async function loadAccounts() {
    const data = await api("meta?kind=accounts");
    setAccounts(data.data);
    setAvailableAccounts(data.available);
    setChosenAccounts(data.selectedAccounts);
    setAccount((prev) => (prev && !data.data.some((a: Item) => a.id === prev) ? "" : prev));
  }
  function applyConnection(c: any) {
    setConnected(c.connected);
    setUserName(c.name || "");
    setMetadata(c.metadata || null);
    setCanExtend(c.canExtend || false);
  }
  async function tokenAction(action: string) {
    setBusy(true);
    setNotice("");
    try {
      const before = tokenDeadline(metadata),
        c = await api("connection", {
          method: "PATCH",
          body: JSON.stringify({ action }),
        });
      applyConnection(c);
      setNotice(action === "extend" ? (tokenDeadline(c.metadata) !== before ? "Token canjeado. La fecha de vencimiento fue actualizada." : "Meta procesó el canje y mantuvo la misma fecha de vencimiento.") : "Vencimiento consultado con Meta.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function openConfig() {
    setNotice("");
    try {
      const config = await api("settings");
      setAppId(config.appId);
      setHasSecret(config.hasAppSecret);
      setAppSecret("");
      setChosenAccounts(config.selectedAccounts);
      setAccountSearch("");
      setConfigOpen(true);
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  async function saveCredentials() {
    setBusy(true);
    setNotice("");
    try {
      await api("settings", {
        method: "POST",
        body: JSON.stringify({
          action: "credentials",
          appId,
          secret: appSecret,
        }),
      });
      setAppSecret("");
      setHasSecret(true);
      applyConnection(await api("connection"));
      setNotice("Clave guardada cifrada. Ya podés consultar o extender el token.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAccounts() {
    setBusy(true);
    setNotice("");
    try {
      await api("settings", {
        method: "POST",
        body: JSON.stringify({
          action: "accounts",
          selectedAccounts: chosenAccounts,
        }),
      });
      await loadAccounts();
      setConfigOpen(false);
      setNotice("Cuentas de trabajo guardadas.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    // Initial bootstrap deliberately synchronizes dependent form state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([fresh()]);
    api("connection").then((c) => {
      applyConnection(c);
      if (c.connected) loadAccounts().catch((e) => setNotice(e.message));
    });
    refreshJobs();
  }, []);
  useEffect(() => {
    const g = ++generation.current.account;
    generation.current.campaign++;
    generation.current.adset++;
    // Account changes invalidate all dependent selections as one transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCampaign("");
    setCampaigns([]);
    setAdset("");
    setSets([]);
    setAds([]);
    setBaseAdId("");
    setCampaignQuery("");
    setAdsetQuery("");
    setAdQuery("");
    setPresets([]);
    setPreset("");
    setModel("");
    setModelInfo(null);
    generation.current.model++;
    pendingPreset.current = null;
    pendingBuild.current = null;
    pendingCreativeModel.current = "";
    setModelLoading(false);
    setModelCampaign("");
    setModelAdset("");
    setModelSets([]);
    setRowAdsets({});
    setDistribution("single");
    setDistributionSetIds([]);
    if (account)
      api("meta?kind=campaigns&account=" + account)
        .then((d) => {
          if (g !== generation.current.account) return;
          setCampaigns(d.data);
          const h = pendingCampaignHandoff.current;
          if (h && h.account === account) {
            pendingBuild.current = {
              campaignId: h.campaignId,
              groups: h.sets.map((s: any) => ({
                key: s.key,
                rowKeys: s.rowKeys || [],
              })),
              sets: h.created,
            };
            pendingCreativeModel.current = h.creativeModel;
            pendingCampaignHandoff.current = null;
            setMode("existing");
            setCampaign(h.campaignId);
          }
        })
        .catch((e) => setNotice(e.message));
  }, [account]);
  useEffect(() => {
    if (!account) return;
    let current = true;
    api("presets?account=" + account)
      .then((d) => {
        if (current) setPresets(d.data);
      })
      .catch((e) => setNotice(e.message));
    return () => {
      current = false;
    };
  }, [account]);
  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  useEffect(() => {
    const g = ++generation.current.campaign;
    generation.current.adset++;
    // Campaign changes invalidate the selected adset before loading its choices.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdset("");
    setSets([]);
    setTemplateSetIds([]);
    setAds([]);
    setBaseAdId("");
    setAdsetQuery("");
    setAdQuery("");
    setDistributionSetIds([]);
    if (!campaign) {
      setRowAdsets({});
      return;
    }
    api("meta?kind=adsets&campaign=" + campaign)
      .then((d) => {
        if (g !== generation.current.campaign) return;
        setSets(d.data);
        setTemplateSetIds(d.data.length === 1 ? [d.data[0].id] : []);
        const pb = pendingBuild.current;
        if (pb && pb.campaignId === campaign) {
          const wanted = new Set(pb.sets.map((x: any) => x.id));
          const available = (d.data as Item[]).filter((s) => wanted.has(s.id));
          const mapping: Record<string, string> = {};
          for (const grp of pb.groups) {
            const created = pb.sets.find((x: any) => x.key === grp.key);
            if (!created) continue;
            for (const rk of grp.rowKeys) mapping[rk] = created.id;
          }
          setRowAdsets(mapping);
          setAdset(available[0]?.id || "");
          pendingBuild.current = null;
        } else {
          setRowAdsets({});
        }
      })
      .catch((e) => setNotice(e.message));
  }, [campaign]);
  useEffect(() => {
    // Changing the model campaign invalidates the model adset selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModelAdset("");
    setModelSets([]);
    if (mode === "campaign" && modelCampaign)
      api("meta?kind=adsets&campaign=" + modelCampaign)
        .then((d) => setModelSets(d.data))
        .catch((e) => setNotice(e.message));
  }, [modelCampaign, mode]);
  useEffect(() => {
    if (mode !== "campaign" || !modelAdset) return;
    const g = ++generation.current.build;
    // Reset stale model details before loading ads for the new model adset.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModel("");
    setModelInfo(null);
    setModelLoading(false);
    setAds([]);
    setAdsLoaded(false);
    setInstagram("");
    const s = modelSets.find((x) => x.id === modelAdset);
    setPage(s?.promoted_object?.page_id || "");
    const nextCta = s?.destination_type === "WHATSAPP" ? "WHATSAPP_MESSAGE" : s?.destination_type === "INSTAGRAM_DIRECT" ? "INSTAGRAM_MESSAGE" : "LEARN_MORE";
    setCommon((prev) => ({
      ...prev,
      cta: nextCta,
      ...(s?.destination_type === "WHATSAPP"
        ? {
            link: "https://wa.me/" + (s.promoted_object?.whatsapp_phone_number || "").replace(/\D/g, ""),
          }
        : {}),
    }));
    if (!modelSets.length) return;
    api("meta?kind=ads&adset=" + modelAdset)
      .then((d) => {
        if (g !== generation.current.build) return;
        setAds(d.data);
        setAdsLoaded(true);
        const c = d.data[0]?.creative;
        setInstagram(c?.instagram_user_id || c?.object_story_spec?.instagram_user_id || "");
      })
      .catch((e) => setNotice(e.message));
  }, [mode, modelAdset, modelSets]);
  useEffect(() => {
    const g = ++generation.current.adset,
      preservedModel = pendingCreativeModel.current;
    if (!preservedModel) {
      generation.current.model++;
      setModel("");
      setModelInfo(null);
      setModelLoading(false);
    }
    // Invalidate the previous adset's ads before fetching the next set.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdsLoaded(false);
    setAds([]);
    setBaseAdId("");
    setAdQuery("");
    setPage("");
    setInstagram("");
    if (adset) {
      setDistributionSetIds((prev) => (prev.length ? prev : [adset]));
      const s = sets.find((s) => s.id === adset);
      setPage(s?.promoted_object?.page_id || "");
      const nextCta = s?.destination_type === "WHATSAPP" ? "WHATSAPP_MESSAGE" : s?.destination_type === "INSTAGRAM_DIRECT" ? "INSTAGRAM_MESSAGE" : "LEARN_MORE";
      setCommon((prev) => ({ ...prev, cta: nextCta }));
      if (s?.destination_type === "WHATSAPP") {
        const link = "https://wa.me/" + (s.promoted_object?.whatsapp_phone_number || "").replace(/\D/g, "");
        setRows((prev) => prev.map((r) => ({ ...r, link })));
        setCommon((prev) => ({ ...prev, link }));
      }
      if (preservedModel) {
        setModel(preservedModel);
        pendingCreativeModel.current = "";
      }
      api("meta?kind=ads&adset=" + adset)
        .then((d) => {
          if (g !== generation.current.adset) return;
          setAds(d.data);
          setAdsLoaded(true);
          if (!preservedModel) {
            const first = d.data[0], c = first?.creative;
            setInstagram(c?.instagram_user_id || c?.object_story_spec?.instagram_user_id || "");
            if (c?.id) {
              setBaseAdId(first.id);
              setModel(c.id);
            }
          } else {
            setBaseAdId(d.data.find((a: Item) => a.creative?.id === preservedModel)?.id || "");
          }
        })
        .catch((e) => setNotice(e.message));
    }
  // `sets` is refreshed asynchronously for campaign changes; the selection
  // remains keyed only by adset to avoid resetting the form on that refresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adset]);
  useEffect(() => {
    const p = pendingPreset.current;
    if (!p || p.account !== account || campaign !== p.campaign || !sets.some((s) => s.id === p.adset)) return;
    setAdset(p.adset);
  }, [sets, campaign, account]);
  useEffect(() => {
    const p = pendingPreset.current;
    if (!p || p.account !== account || adset !== p.adset || !adsLoaded) return;
    setCommon(p.copy);
    setPage(p.page);
    setInstagram(p.instagram);
    setModel(p.model);
    setBaseAdId(p.baseAdId || ads.find((a) => a.creative?.id === p.model)?.id || "");
    setPlacement(p.placement || "ads");
    setDistribution(p.distribution || "single");
    setDistributionSetIds(p.distributionSetIds || [p.adset]);
    setNewSetStructure(p.newSetStructure || "single");
    pendingPreset.current = null;
  }, [ads, adsLoaded, adset, account]);
  useEffect(() => {
    if (!model) {
      // Clear details when the selected creative is removed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModelInfo(null);
      setModelLoading(false);
      return;
    }
    // Keep stale creative details hidden during the next request.
    setModelInfo(null);
    setModelLoading(true);
    const g = ++generation.current.model;
    api("model?account=" + account + "&creative=" + model)
      .then((m) => {
        if (g !== generation.current.model) return;
        setModelInfo(m);
        setModelLoading(false);
        if (m.supported) {
          if (m.page) setPage(m.page);
          if (m.instagram) setInstagram(m.instagram);
          setCommon(m.copy);
        }
        if (m.reason) setNotice(m.reason);
      })
      .catch((e) => {
        if (g === generation.current.model) {
          setModelLoading(false);
          setModel("");
          setNotice(e.message);
        }
      });
  }, [model, account, mode]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    context.registerTool(
      {
        name: "stage_drive_ads",
        title: "Preparar anuncios de Drive",
        description: "Agrega filas al borrador visible. No sube archivos ni crea anuncios en Meta.",
        inputSchema: {
          type: "object",
          properties: {
            ads: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  drive: { type: "string" },
                  mediaType: { type: "string", enum: ["image", "video"] },
                },
                required: ["name", "drive", "mediaType"],
                additionalProperties: false,
              },
            },
          },
          required: ["ads"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false },
        execute(input: any) {
          if (!Array.isArray(input?.ads) || input.ads.length < 1 || input.ads.length > 20 || input.ads.some((a: any) => typeof a.name !== "string" || typeof a.drive !== "string" || !["image", "video"].includes(a.mediaType))) throw new Error("Anuncios inválidos.");
          if (rowsRef.current.length + input.ads.length > MAX_ADS) throw new Error("El lote admite hasta 20 anuncios.");
          setRows((prev) => {
            return [...prev, ...input.ads.map((a: any) => ({ ...fresh(), ...a }))];
          });
          return { staged: input.ads.length };
        },
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, []);
  async function connect() {
    setBusy(true);
    setNotice("");
    try {
      const c = await api("connection", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setToken("");
      applyConnection(c);
      setConnectionOpen(false);
      await loadAccounts();
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }
  function chooseBaseAd(item: Item) {
    if (!item.creative?.id) return;
    setBaseAdId(item.id);
    setModel(item.creative.id);
    setPreset("");
    setPlacementCampaignName((value) => value || `${selectedCampaign?.name || "Campaña"} · copia`);
    setPlacementAdsetName((value) => value || `${selectedSet?.name || "Conjunto"} · copia`);
  }
  function duplicateBaseAd() {
    if (!model || !baseAd) return;
    setRows((prev) => {
      const duplicateNumber = prev.filter((r) => r.source === "existing" && r.creative === model).length + 1;
      const duplicate = {
        ...fresh(),
        nameAuto: false,
        useCommon: false,
        source: "existing",
        creative: model,
        name: `${baseAd.name} · copia${duplicateNumber > 1 ? ` ${duplicateNumber}` : ""}`,
      };
      const onlyBlank = prev.length === 1 && !prev[0].name && !prev[0].drive && !prev[0].uploadKey && !prev[0].creative;
      return onlyBlank ? [duplicate] : [...prev, duplicate].slice(0, MAX_ADS);
    });
  }
  async function upload(row: Row, file?: File) {
    if (!file) return;
    setBusy(true);
    setNotice("");
    try {
      const info = supportedFile(file),
        url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      update(row.key, {
        ...(!row.name || row.nameAuto ? { name: info.name, nameAuto: true } : {}),
        preview: url,
        fileName: file.name,
        uploadKey: undefined,
        uploadError: undefined,
        mediaType: info.mediaType,
      });
      const v = await api("upload", {
        method: "POST",
        body: file,
        headers: { "Content-Type": info.type },
      });
      update(row.key, { uploadKey: v.key });
    } catch (e: any) {
      update(row.key, { uploadError: e.message });
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadFiles(files: FileList | File[]) {
    if (busy || files.length === 0) return;
    const incoming = Array.from(files);
    const base = rows.filter((r) => r.name || r.drive || r.uploadKey || r.fileName || r.creative);
    if (base.length + incoming.length > MAX_ADS) {
      setNotice("El lote admite hasta 20 anuncios.");
      return;
    }
    try {
      incoming.forEach(supportedFile);
    } catch (e: any) {
      setNotice(e.message);
      return;
    }
    setBusy(true);
    setNotice("");
    const added = incoming.map((file) => {
      const info = supportedFile(file),
        url = URL.createObjectURL(file);
      objectUrls.current.add(url);
      return {
        ...fresh(),
        source: "upload",
        name: info.name,
        mediaType: info.mediaType,
        fileName: file.name,
        preview: url,
      };
    });
    setRows([...base, ...added]);
    try {
      for (let i = 0; i < incoming.length; i++) {
        setUploadProgress(`Preparando ${i + 1} de ${incoming.length}`);
        try {
          const info = supportedFile(incoming[i]);
          const v = await api("upload", {
            method: "POST",
            body: incoming[i],
            headers: { "Content-Type": info.type },
          });
          update(added[i].key, { uploadKey: v.key });
        } catch (e: any) {
          update(added[i].key, { uploadError: e.message });
          setNotice(e.message);
        }
      }
    } finally {
      setBusy(false);
      setUploadProgress("");
    }
  }
  async function nameFromDrive(row: Row) {
    if (!row.drive.trim() || row.resolvedDrive === row.drive) return;
    if (looksLikeLocalFilePath(row.drive)) {
      setNotice(LOCAL_PATH_DRIVE_MESSAGE);
      return;
    }
    try {
      const result = await api("file-name", {
        method: "POST",
        body: JSON.stringify({ url: row.drive }),
      });
      setRows((prev) =>
        prev.map((r) =>
          r.key === row.key && r.drive === row.drive && r.source === "drive"
            ? {
                ...r,
                fileName: result.filename,
                resolvedDrive: row.drive,
                ...(!r.name || r.nameAuto ? { name: result.name, nameAuto: true } : {}),
              }
            : r,
        ),
      );
    } catch (e: any) {
      setNotice(e.message);
    }
  }
  async function addDriveBatch() {
    try {
      const base = rows.filter((r) => r.name || r.drive || r.uploadKey || r.fileName || r.creative);
      const links = driveLines(driveBatch, MAX_ADS - base.length);
      const added = links.map((drive) => ({ ...fresh(), drive }));
      setRows([...base, ...added]);
      setDriveBatch("");
      setBusy(true);
      for (const row of added) await nameFromDrive(row);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function savePreset() {
    setBusy(true);
    try {
      await api("presets", {
        method: "POST",
        body: JSON.stringify({
          account,
          name: presetName,
          configuration: {
            campaign,
            adset,
            page,
            instagram,
            model,
            baseAdId,
            copy: common,
            placement,
            distribution,
            distributionSetIds,
            newSetStructure,
          },
        }),
      });
      setPresets((await api("presets?account=" + account)).data);
      setPresetName("");
      setPresetOpen(false);
      setNotice("Preset guardado para esta cuenta.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  function usePreset(value: string) {
    const p = presets.find((p) => p.id === value);
    if (!p) return;
    setPreset(value);
    const config = p.configuration;
    pendingPreset.current = { ...config, account };
    if (campaign === config.campaign && adset === config.adset) {
      setCommon(config.copy);
      setPage(config.page);
      setInstagram(config.instagram);
      setModel(config.model);
      setBaseAdId(config.baseAdId || ads.find((a) => a.creative?.id === config.model)?.id || "");
      setPlacement(config.placement || "ads");
      setDistribution(config.distribution || "single");
      setDistributionSetIds(config.distributionSetIds || [config.adset]);
      setNewSetStructure(config.newSetStructure || "single");
      pendingPreset.current = null;
    } else {
      setCampaign(config.campaign);
      if (sets.some((s) => s.id === config.adset)) setAdset(config.adset);
    }
    setMode("existing");
    setNotice("Preset seleccionado. Se verificará su configuración con Meta al crear cada anuncio.");
  }
  async function runJob(job: any) {
    let current = job;
    let attempts = 0;
    while (["ready", "waiting"].includes(current.status) && !stop.current && attempts++ < 80) {
      if (current.status === "waiting") {
        await new Promise((resolve) => setTimeout(resolve, Math.min(60000, Math.max(10000, (current.state.wait || 10) * 1000))));
      }
      current = await api("jobs", {
        method: "PATCH",
        body: JSON.stringify({ jobId: current.id }),
      });
      await refreshJobs();
      if (current.status === "ready") await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (["failed", "uncertain", "working"].includes(current.status)) throw new Error(current.state?.error || "El trabajo requiere revisión. Consultá el historial antes de repetir.");
    return current;
  }
  async function applyCampaignBuild(campaignId: string, sets: any[], created: any[], creativeModel = "", targetAccount = account) {
    const handoff = {
      campaignId,
      sets,
      created,
      creativeModel,
      account: targetAccount,
    };
    setNotice(`${created.length} conjunto(s) creados en pausa. Cargá los creativos y creá los anuncios${creativeModel ? " usando el creativo modelo seleccionado." : "."}`);
    if (targetAccount !== account) {
      pendingCampaignHandoff.current = handoff;
      setAccount(targetAccount);
      return;
    }
    pendingBuild.current = {
      campaignId,
      groups: sets.map((s) => ({ key: s.key, rowKeys: s.rowKeys || [] })),
      sets: created,
    };
    pendingCreativeModel.current = creativeModel;
    setCampaigns((await api("meta?kind=campaigns&account=" + targetAccount)).data);
    setMode("existing");
    if (campaign === campaignId) {
      setCampaign("");
      setTimeout(() => setCampaign(campaignId), 0);
    } else setCampaign(campaignId);
  }
  async function execute() {
    setReview(false);
    setBusy(true);
    setNotice("");
    stop.current = false;
    setQueueProgress(0);
    try {
      const runId = clientId();
      const runName = mode === "campaign" ? build.name : mode === "template" ? newName : placement === "campaign" ? placementCampaignName : `${selectedCampaign?.name || "Carga"} · ${rows.length} anuncio${rows.length === 1 ? "" : "s"}`;
      const structureGroups = mode === "existing" && placement !== "ads" ? placementGroups : [];
      const runTotal = mode === "existing" ? rows.length + structureGroups.length : 1;
      if (mode === "campaign") {
        const sets = groups.map((g) => ({
            key: g.key,
            name: g.name,
            rowKeys: g.rowKeys,
          })),
          creativeModel = modelInfo?.supported ? model : undefined;
        const payload = {
          kind: "campaign",
          runId,
          runName,
          runIndex: 1,
          runTotal,
          account,
          modelAdset,
          creativeModel,
          name: build.name,
          cbo: build.cbo,
          budgetType: build.budgetType,
          budgetAmount: moneyMinor(build.budgetAmount),
          bidStrategy: build.bidStrategy,
          bidAmount: moneyMinor(build.bidAmount),
          adBudgetType: build.adBudgetType,
          adBudgetAmount: moneyMinor(build.adBudgetAmount),
          startTime: toIso(build.startTime),
          endTime: toIso(build.endTime),
          targeting: {
            countries: splitCodes(build.countries),
            ageMin: ageValue(build.ageMin),
            ageMax: ageValue(build.ageMax),
            genders: splitGenders(build.genders),
          },
          sets,
        };
        const job = await api("jobs", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const result = await runJob(job);
        if (result.status !== "done") {
          setNotice("Creación de la campaña detenida. Retomá desde el historial.");
          await refreshJobs();
          return;
        }
        await applyCampaignBuild(result.state.campaignId || (job.state && job.state.campaignId), sets, result.state.createdSets || [], creativeModel);
      } else if (mode === "template") {
        const job = await api("jobs", {
          method: "POST",
          body: JSON.stringify({
            kind: "template",
            runId,
            runName,
            runIndex: 1,
            runTotal,
            account,
            campaign,
            name: newName,
            adsetIds: templateSetIds,
          }),
        });
        const result = await runJob(job);
        if (result.status !== "done") {
          setNotice("Copia detenida. Retomá desde el historial.");
          return;
        }
        setNotice("Campaña y conjuntos copiados en pausa. Seleccioná la nueva campaña para agregar anuncios.");
        setCampaigns((await api("meta?kind=campaigns&account=" + account)).data);
        setMode("existing");
      } else {
        const structureOffset = structureGroups.length;
        const plannedAds = rows.map((row, i) => {
          const copy = resolveCopy(row, common);
          const targetGroup = placementGroupForRow(row)?.key;
          return {
            kind: "ad",
            runId,
            runName,
            runIndex: i + 1 + structureOffset,
            runTotal,
            account,
            adset: placement === "ads" ? targetAdsetForRow(row, i) : adset,
            targetGroup,
            name: row.name,
            source: row.source,
            creative: row.source === "existing" ? row.creative : undefined,
            mediaType: row.mediaType,
            drive: row.drive,
            uploadKey: row.uploadKey,
            page: page || undefined,
            instagram,
            ...copy,
            model: modelInfo?.supported ? model : undefined,
          };
        });
        await api("jobs", { method: "POST", body: JSON.stringify({ kind: "run-plan", runId, runName, runTotal, account, campaign, adset, placement, campaignName: placementCampaignName, adsetName: placementAdsetName, structureGroups, ads: plannedAds }) });
        const targetSets = new Map<string, string>();
        let targetCampaign = campaign;
        for (let i = 0; i < structureGroups.length; i++) {
          const group = structureGroups[i];
          if (placement === "campaign" && i === 0) {
            const structureJob = await api("jobs", { method: "POST", body: JSON.stringify({ kind: "template", runId, runName, runIndex: 1, runTotal, account, campaign, name: placementCampaignName, adsetIds: [adset], adsetName: group.name }) });
            const structure = await runJob(structureJob);
            targetCampaign = structure.state.campaignId;
            const target = structure.state.copiedSets?.[0]?.id;
            if (!targetCampaign || !target) throw new Error("Meta no devolvió la estructura de la campaña nueva.");
            targetSets.set(group.key, target);
          } else {
            const structureJob = await api("jobs", { method: "POST", body: JSON.stringify({ kind: "adset-copy", runId, runName, runIndex: i + 1, runTotal, account, campaign: targetCampaign, adset, name: group.name }) });
            const structure = await runJob(structureJob);
            if (!structure.state.adsetId) throw new Error("Meta no devolvió uno de los conjuntos nuevos.");
            targetSets.set(group.key, structure.state.adsetId);
          }
        }
        const queued: any[] = [];
        for (const planned of plannedAds) {
          const payload = { ...planned, adset: placement === "ads" ? planned.adset : targetSets.get(planned.targetGroup) };
          const job = await api("jobs", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          queued.push({ ...job, payload });
        }
        await refreshJobs();
        for (let i = 0; i < queued.length && !stop.current; i++) {
          const job = queued[i];
          const completed = await runJob(job);
          if (completed.status !== "done") break;
          setQueueProgress(Math.round(((i + 1) / rows.length) * 100));
        }
        setNotice(stop.current ? "Cola detenida. Podés retomar desde el historial." : "Revisá el historial para ver los anuncios creados y sus estados.");
      }
      await refreshJobs();
    } catch (e: any) {
      setNotice(e.message);
      await refreshJobs();
    } finally {
      setBusy(false);
    }
  }
  async function prepareRecovery(job: any) {
    setRecoveryLoading(true);
    setNotice("");
    try {
      setRecovery(await api("recovery?job=" + job.id));
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setRecoveryLoading(false);
    }
  }
  async function recover() {
    if (!recovery) return;
    setBusy(true);
    stop.current = false;
    setNotice("");
    try {
      const job = await api("recovery", {
        method: "POST",
        body: JSON.stringify({
          jobId: recovery.jobId,
          fingerprint: recovery.fingerprint,
        }),
      });
      setRecovery(null);
      const result = await runJob(job);
      setNotice(result.status === "done" ? "Copia completada en la campaña ya creada. El conjunto nuevo usa atribución de clic de 1 día y está pausado." : "La recuperación quedó pendiente. Revisá el historial.");
      await refreshJobs();
    } catch (e: any) {
      setNotice(e.message);
      await refreshJobs();
    } finally {
      setBusy(false);
    }
  }
  async function resume(job: any) {
    setBusy(true);
    stop.current = false;
    try {
      const next = canResumeRejectedJob(job)
        ? await api("jobs", {
            method: "PATCH",
            body: JSON.stringify({ jobId: job.id, retryPreparation: true }),
          })
        : job;
      const result = await runJob(next);
      await refreshJobs();
      if (job.kind === "campaign" && result.status === "done") await applyCampaignBuild(result.state.campaignId, job.payload?.sets || [], result.state.createdSets || [], job.payload?.creativeModel || "", job.payload?.account || account);
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function resumeRun(run: JobRun) {
    const plan = run.plan?.payload;
    if (!plan) return;
    setBusy(true);
    stop.current = false;
    setNotice("");
    try {
      const operations = [...run.jobs];
      const structureGroups = plan.placement === "ads" ? [] : plan.structureGroups?.length ? plan.structureGroups : [{ key: "legacy", name: plan.adsetName, rowKeys: plan.ads.map((ad: any) => ad.name) }];
      const targetSets = new Map<string, string>();
      let targetCampaign = plan.campaign;
      if (plan.placement !== "ads") {
        for (let i = 0; i < structureGroups.length; i++) {
          const group = structureGroups[i];
          const structureKind = plan.placement === "campaign" && i === 0 ? "template" : "adset-copy";
          const structurePayload = structureKind === "template"
            ? { kind: "template", runId: plan.runId, runName: plan.runName, runIndex: 1, runTotal: plan.runTotal, account: plan.account, campaign: plan.campaign, name: plan.campaignName, adsetIds: [plan.adset], adsetName: group.name }
            : { kind: "adset-copy", runId: plan.runId, runName: plan.runName, runIndex: i + 1, runTotal: plan.runTotal, account: plan.account, campaign: targetCampaign, adset: plan.adset, name: group.name };
          let structure = operations.find((job) => job.kind === structureKind && Number(job.payload.runIndex) === i + 1);
          if (!structure) {
            const created = await api("jobs", { method: "POST", body: JSON.stringify(structurePayload) });
            structure = { ...created, kind: structureKind, payload: structurePayload };
            operations.push(structure);
          }
          if (structure.status !== "done") {
            if (structure.status === "failed" && !canResumeRejectedJob(structure)) throw new Error(structure.state?.error || "La estructura requiere revisión.");
            const next = structure.status === "failed" ? await api("jobs", { method: "PATCH", body: JSON.stringify({ jobId: structure.id, retryPreparation: true }) }) : structure;
            structure = { ...structure, ...(await runJob(next)) };
          }
          if (structureKind === "template") targetCampaign = structure.state.campaignId;
          const target = structureKind === "template" ? structure.state.copiedSets?.[0]?.id : structure.state.adsetId;
          if (!targetCampaign || !target) throw new Error("No se encontró la estructura de destino del run.");
          targetSets.set(group.key, target);
        }
      }
      const plannedAds = [...plan.ads].sort((a: any, b: any) => a.runIndex - b.runIndex);
      for (let i = 0; i < plannedAds.length && !stop.current; i++) {
        const payload = { ...plannedAds[i], adset: plan.placement === "ads" ? plannedAds[i].adset : targetSets.get(plannedAds[i].targetGroup || structureGroups[0]?.key) };
        let job = operations.find((candidate) => candidate.kind === "ad" && candidate.payload.runIndex === payload.runIndex);
        if (!job) {
          const created = await api("jobs", { method: "POST", body: JSON.stringify(payload) });
          job = { ...created, kind: "ad", payload };
          operations.push(job);
        }
        if (job.status === "done") {
          setQueueProgress(Math.round(((i + 1) / plannedAds.length) * 100));
          continue;
        }
        if (job.status === "failed" && !canResumeRejectedJob(job)) throw new Error(job.state?.error || "Este anuncio requiere revisión.");
        const next = job.status === "failed" ? await api("jobs", { method: "PATCH", body: JSON.stringify({ jobId: job.id, retryPreparation: true }) }) : job;
        await runJob(next);
        setQueueProgress(Math.round(((i + 1) / plannedAds.length) * 100));
      }
      setNotice(stop.current ? "Carga detenida. Podés retomarla nuevamente desde el historial." : "Carga retomada y completada.");
      await refreshJobs();
    } catch (e: any) {
      setNotice(e.message);
      await refreshJobs();
    } finally {
      setBusy(false);
    }
  }
  const money = (v: string) =>
    selectedAccount
      ? new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: selectedAccount.currency || "USD",
        }).format(Number(v) / 100)
      : v;
  const moneyMinor = (v: string) => Math.max(0, Math.round(Number(String(v ?? "").replace(",", ".")) || 0) * 100);
  const toIso = (v: string) => {
    if (!v) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };
  const numberOrNull = (v: string) => {
    const n = Number(v);
    return v !== "" && v != null && Number.isFinite(n) ? n : null;
  };
  const splitCodes = (v: string) => [
    ...new Set(
      v
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^[A-Z]{2}$/.test(s)),
    ),
  ];
  const splitGenders = (v: string) => (v === "1" ? [1] : v === "2" ? [2] : []);
  const ageValue = (v: string) => {
    const n = numberOrNull(v);
    return n == null ? null : Math.min(65, Math.max(18, Math.round(n)));
  };
  const budgetOk = build.cbo ? moneyMinor(build.budgetAmount) > 0 : moneyMinor(build.adBudgetAmount) > 0;
  const budgetLifetime = build.cbo ? build.budgetType === "lifetime" : build.adBudgetType === "lifetime";
  const scheduleOk = !budgetLifetime || Boolean(build.endTime && (!build.startTime || new Date(build.endTime) > new Date(build.startTime)));
  const bidOk = build.bidStrategy === "LOWEST_COST_WITHOUT_CAP" || moneyMinor(build.bidAmount) > 0;
  const valid = connected && !modelLoading && account && (mode === "campaign" ? Boolean(build.name.trim() && modelAdset && modelObjective && !structureError && groups.length > 0 && rows.length > 0 && rows.every((r) => r.name.trim()) && budgetOk && bidOk && scheduleOk) : mode === "template" ? Boolean(campaign && newName.trim() && templateSets.length > 0 && templateSets.length <= 20) : Boolean(campaign && adset && model && (placement !== "campaign" || placementCampaignName.trim()) && (placement === "ads" || ((newSetStructure !== "single" || placementAdsetName.trim()) && !placementStructureError && placementGroups.length)) && rows.length > 0 && rows.every((r, i) => r.name.trim() && targetAdsetForRow(r, i) && (r.source === "existing" ? r.creative : modelInfo?.supported && (r.source === "drive" ? r.drive : r.uploadKey) && page && (selectedSet?.destination_type !== "WEBSITE" || resolveCopy(r, common).link) && !r.uploadError))));
  const selectFeature = (nextMode: "existing" | "template" | "campaign") => {
    if (busy) return;
    setMode(nextMode);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openHistory = () => document.getElementById("history")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <SidebarProvider className="shell" style={{ "--sidebar-width": "15rem", "--sidebar-width-icon": "4rem" } as CSSProperties}>
      <FeatureSidebar mode={mode} busy={busy} connected={connected} userName={userName} selectFeature={selectFeature} openHistory={openHistory} openConfig={openConfig} openConnection={() => setConnectionOpen(true)} />
      <SidebarInset className="workspace-main">
        <header className="topbar">
          <div className="topbar-heading">
            <SidebarTrigger aria-label="Mostrar u ocultar navegación" />
            <div>
              <strong>Crear anuncios</strong>
              <span>Carga masiva para Meta Ads</span>
            </div>
          </div>
          <div className="connection-tools">
            {connected && (
              <span className="token-summary" title={metadata ? `Consultado: ${new Date(metadata.checkedAt).toLocaleString("es-AR")}` : undefined}>
                {tokenLabel(metadata, clock)}
              </span>
            )}
            {nodeRuntime && (
              <button
                className="text-button"
                onClick={async () => {
                  const { authClient } = await import("@/lib/auth-client");
                  await authClient.signOut();
                  router.push("/sign-in");
                  router.refresh();
                }}
              >
                Cerrar sesión
              </button>
            )}
          </div>
        </header>
        <section className="intro">
          <div>
            <div className="eyebrow">TU ESPACIO DE CARGA</div>
            <h1>Subí creativos desde una campaña base.</h1>
            <p>Heredamos audiencia, formulario, mensajería y conversión. Vos sólo cargás los archivos.</p>
          </div>
          <div className="paused">
            <AppIcon icon={PauseCircle} size="secondary" />
            Todos los anuncios se crean pausados
          </div>
        </section>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Cerrar aviso">
              ×
            </button>
          </div>
        )}
        <div className="workspace-grid">
          <div className="editor">
            <section className="panel work-panel">
              <div className="work-panel-heading">
                <span className="step">01</span>
                <div>
                  <h2>Elegí dónde trabajar</h2>
                  <p>Seleccioná tu cuenta publicitaria y el anuncio base de Meta desde el cual vamos a heredar la configuración.</p>
                </div>
              </div>
              <AccountPicker value={account} onChange={setAccount} items={accounts} disabled={!connected || busy} connected={connected} />
              {account && (
                <div className="preset-toolbar">
                  <Picker label="Preset de anuncio base" value={preset} onChange={usePreset} items={presets} disabled={busy || !presets.length} placeholder={presets.length ? "Elegí un preset de esta cuenta" : "Todavía no hay presets en esta cuenta"} />
                  <button className="secondary-button" disabled={busy || !campaign || !adset} onClick={() => setPresetOpen(true)}>
                    Guardar configuración
                  </button>
                  {preset && (
                    <button
                      className="icon-button"
                      aria-label="Eliminar preset seleccionado"
                      disabled={busy}
                      onClick={async () => {
                        try {
                          await api("presets", {
                            method: "DELETE",
                            body: JSON.stringify({ id: preset, account }),
                          });
                          setPreset("");
                          setPresets((await api("presets?account=" + account)).data);
                        } catch (e: any) {
                          setNotice(e.message);
                        }
                      }}
                    >
                      <AppIcon icon={Trash2} size="secondary" />
                    </button>
                  )}
                </div>
              )}
              {mode === "campaign" ? (
                <div className="campaign-config">
                  <label className="field">
                    <span>Nombre de la nueva campaña</span>
                    <input value={build.name} onChange={(e) => patchBuild({ name: e.target.value })} placeholder="Ej. Octubre · Nuevos creativos" disabled={busy} />
                  </label>
                  <div className="two-columns">
                    <Picker label="Campaña modelo · hereda configuración" value={modelCampaign} onChange={setModelCampaign} items={campaigns} disabled={!account || busy} placeholder="Elegí una campaña" />
                    <Picker label="Conjunto modelo" value={modelAdset} onChange={setModelAdset} items={modelSets} disabled={!modelCampaign || busy} placeholder={modelCampaign ? "Elegí un conjunto" : "Elegí primero la campaña"} />
                  </div>
                  <div className="two-columns">
                    <label className="field">
                      <span>Objetivo · heredado del modelo</span>
                      <input value={modelObjective || "Elegí una campaña modelo primero"} readOnly disabled />
                    </label>
                    <Picker
                      label="Presupuesto"
                      value={build.cbo ? "campaign" : "adset"}
                      onChange={(v) => patchBuild({ cbo: v === "campaign" })}
                      items={[
                        {
                          id: "campaign",
                          name: "Optimizado por campaña (CBO)",
                        },
                        { id: "adset", name: "Por conjunto (ABO)" },
                      ]}
                      disabled={busy}
                    />
                  </div>
                  {build.cbo ? (
                    <div className="two-columns">
                      <Picker
                        label="Presupuesto de campaña"
                        value={build.budgetType}
                        onChange={(v) => patchBuild({ budgetType: v })}
                        items={[
                          { id: "daily", name: "Diario" },
                          { id: "lifetime", name: "Total" },
                        ]}
                        disabled={busy}
                      />
                      <label className="field">
                        <span>Monto · {selectedAccount?.currency || "USD"}</span>
                        <input inputMode="decimal" value={build.budgetAmount} onChange={(e) => patchBuild({ budgetAmount: e.target.value })} placeholder="Ej. 50" disabled={busy} />
                      </label>
                    </div>
                  ) : (
                    <div className="two-columns">
                      <Picker
                        label="Presupuesto por conjunto"
                        value={build.adBudgetType}
                        onChange={(v) => patchBuild({ adBudgetType: v })}
                        items={[
                          { id: "daily", name: "Diario" },
                          { id: "lifetime", name: "Total" },
                        ]}
                        disabled={busy}
                      />
                      <label className="field">
                        <span>Monto por conjunto · {selectedAccount?.currency || "USD"}</span>
                        <input inputMode="decimal" value={build.adBudgetAmount} onChange={(e) => patchBuild({ adBudgetAmount: e.target.value })} placeholder="Ej. 20" disabled={busy} />
                      </label>
                    </div>
                  )}
                  {budgetLifetime && (
                    <div className="two-columns">
                      <label className="field">
                        <span>Inicio · opcional</span>
                        <input type="datetime-local" value={build.startTime} onChange={(e) => patchBuild({ startTime: e.target.value })} disabled={busy} />
                      </label>
                      <label className="field">
                        <span>Fin · requerido para presupuesto total</span>
                        <input type="datetime-local" value={build.endTime} onChange={(e) => patchBuild({ endTime: e.target.value })} disabled={busy} />
                      </label>
                    </div>
                  )}
                  <div className="two-columns">
                    <Picker
                      label="Estrategia de puja"
                      value={build.bidStrategy}
                      onChange={(v) => patchBuild({ bidStrategy: v })}
                      items={[
                        {
                          id: "LOWEST_COST_WITHOUT_CAP",
                          name: "Menor costo sin tope",
                        },
                        {
                          id: "LOWEST_COST_WITH_BID_CAP",
                          name: "Tope de puja",
                        },
                        { id: "COST_CAP", name: "Costo objetivo" },
                      ]}
                      disabled={busy}
                    />
                    <label className="field">
                      <span>Monto de puja · {selectedAccount?.currency || "USD"}</span>
                      <input inputMode="decimal" value={build.bidAmount} onChange={(e) => patchBuild({ bidAmount: e.target.value })} placeholder="Solo con tope" disabled={busy || build.bidStrategy === "LOWEST_COST_WITHOUT_CAP"} />
                    </label>
                  </div>
                  <div className="two-columns">
                    <label className="field">
                      <span>
                        Países · opcional <small>ISO, separados por coma</small>
                      </span>
                      <input value={build.countries} onChange={(e) => patchBuild({ countries: e.target.value })} placeholder="AR, MX, ES" disabled={busy} />
                    </label>
                    <Picker
                      label="Género"
                      value={build.genders}
                      onChange={(v) => patchBuild({ genders: v })}
                      items={[
                        { id: "all", name: "Todos" },
                        { id: "1", name: "Hombres" },
                        { id: "2", name: "Mujeres" },
                      ]}
                      disabled={busy}
                    />
                  </div>
                  <div className="two-columns">
                    <label className="field">
                      <span>Edad mínima · opcional</span>
                      <input inputMode="numeric" value={build.ageMin} onChange={(e) => patchBuild({ ageMin: e.target.value })} placeholder="18" disabled={busy} />
                    </label>
                    <label className="field">
                      <span>Edad máxima · opcional</span>
                      <input inputMode="numeric" value={build.ageMax} onChange={(e) => patchBuild({ ageMax: e.target.value })} placeholder="65" disabled={busy} />
                    </label>
                  </div>
                  <Picker
                    label="Estructura de conjuntos"
                    value={build.structure}
                    onChange={(v) => patchBuild({ structure: v })}
                    items={GROUPING_MODES.map((m) => ({
                      id: m,
                      name: STRUCTURE_LABELS[m],
                    }))}
                    disabled={busy}
                  />
                  {structureError ? (
                    <p className="error-detail" role="alert">
                      {structureError}
                    </p>
                  ) : (
                    <div className="structure-preview">
                      <p className="helper">
                        {groups.length} conjunto(s) · {rows.length} anuncio(s) en el lote
                      </p>
                      <ul>
                        {groups.map((g) => (
                          <li key={g.key}>
                            <strong>{g.name}</strong>
                            <span>{g.rowKeys.length} anuncio(s)</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="helper">La campaña y los conjuntos se crean pausados tomando la configuración del conjunto modelo. Después cargás los creativos y creás los anuncios.</p>
                </div>
              ) : mode === "existing" ? (
                <section className="base-browser" aria-label="Seleccionar anuncio base">
                  <div className="base-browser-intro">
                    <div className="browser-heading">
                      <span className="browser-title-icon"><AppIcon icon={Copy} /></span>
                      <div className="browser-copy">
                        <h3>Seleccioná un anuncio de Meta</h3>
                        <p>Vamos a copiar su campaña, conjunto, destino y configuración del creativo.</p>
                      </div>
                    </div>
                    {metaManagerUrl && <a className="meta-manager-link" href={metaManagerUrl} target="_blank" rel="noreferrer">Ver en Meta Ads Manager <AppIcon icon={ExternalLink} size="secondary" /></a>}
                  </div>
                  <div className="base-browser-columns">
                    <div className="base-browser-column">
                      <strong>Campañas</strong>
                      <label className="search-field"><AppIcon icon={Search} size="secondary" /><input aria-label="Buscar campañas" value={campaignQuery} onChange={(e) => setCampaignQuery(e.target.value)} placeholder="Buscar campañas…" disabled={busy} /></label>
                      <div className="base-browser-list">
                        {visibleCampaigns.map((item) => (
                          <EntityRow key={item.id} item={item} icon={Folder} selected={campaign === item.id} disabled={busy} onClick={() => setCampaign(item.id)} />
                        ))}
                        {!visibleCampaigns.length && <p>Sin resultados</p>}
                      </div>
                    </div>
                    <div className="base-browser-column">
                      <strong>Conjuntos</strong>
                      <label className="search-field"><AppIcon icon={Search} size="secondary" /><input aria-label="Buscar conjuntos" value={adsetQuery} onChange={(e) => setAdsetQuery(e.target.value)} placeholder="Buscar conjuntos…" disabled={!campaign || busy} /></label>
                      <div className="base-browser-list">
                        {visibleSets.map((item) => (
                          <EntityRow key={item.id} item={item} icon={Layers3} selected={adset === item.id} disabled={busy} onClick={() => setAdset(item.id)} />
                        ))}
                        {campaign && !visibleSets.length && <p>Sin resultados</p>}
                      </div>
                    </div>
                    <div className="base-browser-column">
                      <strong>Anuncios</strong>
                      <label className="search-field"><AppIcon icon={Search} size="secondary" /><input aria-label="Buscar anuncios" value={adQuery} onChange={(e) => setAdQuery(e.target.value)} placeholder="Buscar anuncios…" disabled={!adset || busy} /></label>
                      <div className="base-browser-list">
                        {visibleAds.map((item) => (
                          <EntityRow key={item.id} item={item} thumbnail selected={baseAdId === item.id} disabled={busy || !item.creative?.id} onClick={() => chooseBaseAd(item)} />
                        ))}
                        {adset && adsLoaded && !visibleAds.length && <p>Sin anuncios</p>}
                      </div>
                    </div>
                  </div>
                  {baseAd && <div className="base-path"><span>{selectedCampaign?.name}</span><AppIcon icon={ChevronRight} size="secondary" /><span>{selectedSet?.name}</span><AppIcon icon={ChevronRight} size="secondary" /><strong>{baseAd.name}</strong></div>}
                </section>
              ) : (
                <div className="two-columns">
                  <Picker label="Campaña plantilla" value={campaign} onChange={setCampaign} items={campaigns} disabled={!account || busy} />
                  <label className="field"><span>Nombre de la nueva campaña</span><input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej. Octubre · Nuevos creativos" disabled={busy} /></label>
                </div>
              )}
              {mode === "existing" && selectedSet && (
                <div className="destination">
                  <span>Destino</span>
                  <strong>{selectedSet.destination_type}</strong>
                  <span>Optimización</span>
                  <strong>{selectedSet.optimization_goal}</strong>
                </div>
              )}
              {mode === "existing" && baseAd && (
                <section className="placement-options">
                  <h3>2. Elegí la estructura de destino</h3>
                  <div className="choice-grid">
                    {([
                      ["ads", "Usar estructura existente", `Crea anuncios dentro de ${selectedCampaign?.name} y permite distribuirlos entre sus conjuntos.`],
                      ["adset", "Crear conjunto nuevo", "Copia el conjunto base dentro de la campaña seleccionada."],
                      ["campaign", "Crear campaña nueva", "Copia la campaña y el conjunto base antes de crear los anuncios."],
                    ] as const).map(([value, title, description]) => (
                      <label className={placement === value ? "choice-card selected" : "choice-card"} key={value}>
                        <input type="radio" name="placement" checked={placement === value} onChange={() => setPlacement(value)} disabled={busy} />
                        <span><strong>{title}</strong><small>{description}</small></span>
                      </label>
                    ))}
                  </div>
                  {placement === "campaign" && <label className="field"><span>Nombre de la nueva campaña</span><input value={placementCampaignName} onChange={(e) => setPlacementCampaignName(e.target.value)} placeholder="Ej. Ventas · Nuevos creativos" disabled={busy} /></label>}
                  {placement !== "ads" && (
                    <div className="distribution-options">
                      <h3>3. Definí cuántos conjuntos crear</h3>
                      <Picker label="Distribución" value={newSetStructure} onChange={setNewSetStructure} items={GROUPING_MODES.map((value) => ({ id: value, name: STRUCTURE_LABELS[value] }))} disabled={busy} />
                      {newSetStructure === "single" && <label className="field"><span>Nombre del nuevo conjunto</span><input value={placementAdsetName} onChange={(e) => setPlacementAdsetName(e.target.value)} placeholder="Ej. Creativos octubre" disabled={busy} /></label>}
                      {placementStructureError ? <p className="error-detail">{placementStructureError}</p> : (
                        <div className="structure-preview">
                          <p className="helper">{placementGroups.length} conjunto(s) nuevo(s) · {rows.length} anuncio(s)</p>
                          <ul>{placementGroups.map((group) => <li key={group.key}><strong>{group.name}</strong><span>{group.rowKeys.length} anuncio(s)</span></li>)}</ul>
                        </div>
                      )}
                    </div>
                  )}
                  {placement === "ads" && (
                    <div className="distribution-options">
                      <h3>3. Distribuí los anuncios</h3>
                      <div className="choice-grid compact">
                        {([
                          ["single", "Un conjunto", `Todos van a ${selectedSet?.name}.`],
                          ["round-robin", "Automática", "Reparte el lote en orden entre los conjuntos elegidos."],
                          ["manual", "Manual", "Elegís el conjunto de cada anuncio."],
                        ] as const).map(([value, title, description]) => (
                          <label className={distribution === value ? "choice-card selected" : "choice-card"} key={value}>
                            <input type="radio" name="distribution" checked={distribution === value} onChange={() => { setDistribution(value); if (value === "round-robin" && !distributionSetIds.length) setDistributionSetIds([adset]); }} disabled={busy} />
                            <span><strong>{title}</strong><small>{description}</small></span>
                          </label>
                        ))}
                      </div>
                      {distribution === "round-robin" && (
                        <div className="distribution-sets">
                          <p className="helper">Elegí al menos un conjunto compatible. El orden de esta lista define el reparto.</p>
                          {sets.map((set) => (
                            <label key={set.id}>
                              <Checkbox checked={distributionSetIds.includes(set.id)} disabled={busy} onCheckedChange={(checked) => setDistributionSetIds((prev) => checked ? [...new Set([...prev, set.id])] : prev.filter((id) => id !== set.id))} />
                              <span>{set.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
              {mode === "campaign" && buildSource && (
                <div className="destination">
                  <span>Modelo</span>
                  <strong>{buildSource.name}</strong>
                  <span>Destino</span>
                  <strong>{buildSource.destination_type}</strong>
                  <span>Optimización</span>
                  <strong>{buildSource.optimization_goal}</strong>
                </div>
              )}
              {mode === "template" && sets.length > 0 && (
                <section className="template-selection">
                  <h3>Conjuntos que querés copiar</h3>
                  <div className="token-actions">
                    <button className="text-button" disabled={busy || sets.length > 20} onClick={() => setTemplateSetIds(sets.map((s) => s.id))}>
                      Seleccionar todos
                    </button>
                    <button className="text-button" disabled={busy} onClick={() => setTemplateSetIds([])}>
                      Limpiar selección
                    </button>
                  </div>
                  <div className="account-options">
                    {sets.map((s) => (
                      <label className="account-option" key={s.id}>
                        <Checkbox checked={templateSetIds.includes(s.id)} disabled={busy || (!templateSetIds.includes(s.id) && templateSetIds.length >= 20)} onCheckedChange={(checked) => setTemplateSetIds((prev) => (checked === true ? [...new Set([...prev, s.id])] : prev.filter((id) => id !== s.id)))} />
                        <span>
                          <strong>{s.name}</strong>
                          <small>
                            {s.destination_type} · {s.daily_budget ? money(s.daily_budget) + " por día" : s.lifetime_budget ? money(s.lifetime_budget) + " total" : "presupuesto de campaña"}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="helper">Elegí entre 1 y 20 conjuntos. Se copian solo los seleccionados, sin anuncios.</p>
                </section>
              )}
              {mode === "template" && selectedCampaign && (
                <div className="template-info">
                  <AppIcon icon={Layers3} />
                  <div>
                    <strong>
                      {templateSets.length} de {sets.length} conjuntos seleccionados · {selectedCampaign.objective}
                    </strong>
                    <p>Se conserva la configuración de la campaña y sus conjuntos. No se copian los anuncios. Revisá presupuesto, fechas, audiencia y evento en Ads Manager antes de activar.</p>
                  </div>
                </div>
              )}
            </section>
            {mode !== "template" && (
              <section className="panel">
                <div className="section-title">
                  <span className="step">02</span>
                  <h2>Prepará tus anuncios</h2>
                  <span className="count">{rows.length}</span>
                </div>
                <div className="model-toolbar">
                  <div className="selected-base-summary"><span>Anuncio base</span><strong>{baseAd?.name || "Seleccioná uno arriba"}</strong></div>
                  <button className="secondary-button" disabled={!baseAd || busy || rows.filter((r) => r.name || r.drive || r.uploadKey || r.creative).length >= MAX_ADS} onClick={duplicateBaseAd}>
                    Duplicar anuncio base
                  </button>
                </div>
                {modelInfo && (
                  <div className={"base-ad-status " + (modelInfo.supported ? "ready" : "duplicable")}>
                    <strong>{modelInfo.kindLabel || "Campaña base"}</strong>
                    <span>{modelInfo.supported ? "Se heredan destino, identidad y configuración del anuncio." : `${modelInfo.reason} Podés duplicarlo sin modificar su creativo.`}</span>
                  </div>
                )}
                <div
                  className="batch-import"
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!busy) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                >
                  <div className={"batch-drop " + (dragging ? "dragging" : "")}>
                    <AppIcon icon={UploadCloud} size="large" />
                    <div>
                      <strong>Arrastrá todos tus creativos acá</strong>
                      <p>Imágenes y videos · hasta 20 por lote · {mediaLimitMb()} MB por archivo</p>
                    </div>
                    <label className="secondary-button">
                      Elegir archivos
                      <input
                        className="visually-hidden"
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,video/mp4,video/quicktime"
                        disabled={busy}
                        onChange={(e) => {
                          if (e.target.files) void uploadFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {uploadProgress && (
                    <p className="helper" role="status">
                      {uploadProgress}
                    </p>
                  )}
                  <details className="drive-batch">
                    <summary>Agregar varios enlaces de Google Drive</summary>
                    <label className="field">
                      <span>Un enlace por línea</span>
                      <textarea value={driveBatch} disabled={busy} onChange={(e) => setDriveBatch(e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />
                    </label>
                    <button className="secondary-button" disabled={busy || !driveBatch.trim()} onClick={addDriveBatch}>
                      Agregar enlaces al lote
                    </button>
                    <p className="helper">Elegí imagen o video para cada enlace. Drive debe permitir acceso mediante enlace.</p>
                  </details>
                </div>
                <div className="common-copy">
                  <div className="section-title">
                    <h3>Texto común del lote</h3>
                    <span className="helper">Para los anuncios con creativos nuevos</span>
                  </div>
                  <label className="field">
                    <span>Texto principal</span>
                    <textarea
                      value={common.message}
                      disabled={busy}
                      onChange={(e) =>
                        setCommon((prev) => ({
                          ...prev,
                          message: e.target.value,
                        }))
                      }
                      placeholder="El mismo mensaje para todos tus creativos"
                    />
                  </label>
                  <div className="two-columns">
                    <label className="field">
                      <span>Título</span>
                      <input
                        value={common.title}
                        disabled={busy}
                        onChange={(e) =>
                          setCommon((prev) => ({
                            ...prev,
                            title: e.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Descripción</span>
                      <input
                        value={common.description}
                        disabled={busy}
                        onChange={(e) =>
                          setCommon((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="two-columns">
                    <label className="field">
                      <span>Enlace de destino</span>
                      <input
                        value={common.link}
                        disabled={busy}
                        onChange={(e) =>
                          setCommon((prev) => ({
                            ...prev,
                            link: e.target.value,
                          }))
                        }
                        placeholder="https://…"
                      />
                    </label>
                    <label className="field">
                      <span>Parámetros de URL · opcional</span>
                      <input
                        value={common.urlTags}
                        disabled={busy}
                        onChange={(e) =>
                          setCommon((prev) => ({
                            ...prev,
                            urlTags: e.target.value,
                          }))
                        }
                        placeholder="utm_source=meta&utm_campaign=octubre"
                      />
                    </label>
                  </div>
                </div>
                {rows.some((r) => r.source !== "existing") && (
                  <div className="identity">
                    <strong>Configuración heredada del anuncio base</strong>
                    <p>
                      Página {page || "—"}
                      {instagram ? ` · Instagram ${instagram}` : ""} · Botón {common.cta || "—"}
                    </p>
                    <small>El formulario, la plantilla de mensajes o el evento de conversión no se modifican.</small>
                  </div>
                )}
                {rows.map((row, i) => (
                  <article className="ad-row" key={row.key}>
                    <div className="ad-row-top">
                      {(row.preview || (row.source === "existing" && ads.find((a) => a.creative?.id === row.creative)?.creative?.thumbnail_url)) && (
                        <button className="preview-thumb" onClick={() => setPreview(row)} aria-label={"Ver creativo " + (row.name || i + 1)}>
                          {/* Blob previews and Meta thumbnail URLs are displayed directly. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {row.mediaType === "video" && row.preview ? <AppIcon icon={Video} size="large" /> : <img src={row.preview || ads.find((a) => a.creative?.id === row.creative)?.creative?.thumbnail_url} alt="" />}
                        </button>
                      )}
                      <div className="ad-number">{String(i + 1).padStart(2, "0")}</div>
                      <input
                        className="ad-name"
                        aria-label={`Nombre del anuncio ${i + 1}`}
                        value={row.name}
                        onChange={(e) =>
                          update(row.key, {
                            name: e.target.value,
                            nameAuto: false,
                          })
                        }
                        placeholder="Nombre del anuncio"
                        disabled={busy}
                      />
                      <button className="icon-button" aria-label="Eliminar anuncio" onClick={() => removeRow(row.key)} disabled={busy}>
                        <AppIcon icon={Trash2} size="secondary" />
                      </button>
                    </div>
                    {mode === "campaign" && (
                      <div className="row-group">
                        {build.structure === "custom" ? (
                          <label className="field">
                            <span>Conjunto nuevo para este anuncio</span>
                            <input value={row.group || ""} onChange={(e) => update(row.key, { group: e.target.value })} placeholder="Ej. Hook A" disabled={busy} />
                          </label>
                        ) : (
                          <p className="helper">
                            Conjunto: <strong>{groupForRow(row) || "sin nombre"}</strong>
                          </p>
                        )}
                      </div>
                    )}
                    {mode === "existing" && placement !== "ads" && newSetStructure === "custom" && (
                      <div className="row-group">
                        <label className="field"><span>Conjunto nuevo para este anuncio</span><input value={row.group || ""} onChange={(e) => update(row.key, { group: e.target.value })} placeholder="Ej. Hook A" disabled={busy} /></label>
                      </div>
                    )}
                    {mode === "existing" && placement !== "ads" && newSetStructure !== "custom" && (
                      <p className="helper">Conjunto nuevo: <strong>{placementGroupForRow(row)?.name || "sin asignar"}</strong></p>
                    )}
                    {mode === "existing" && placement === "ads" && distribution === "manual" ? (
                      <div className="row-group">
                        <Picker label="Conjunto de destino" value={rowAdsets[row.key] || ""} onChange={(target) => setRowAdsets((prev) => ({ ...prev, [row.key]: target }))} items={sets} disabled={busy} placeholder="Elegí un conjunto" />
                      </div>
                    ) : mode === "existing" && placement === "ads" && distribution !== "single" ? (
                      <p className="helper">
                        Se creará en: <strong>{sets.find((s) => s.id === targetAdsetForRow(row, i))?.name || "sin asignar"}</strong>
                      </p>
                    ) : null}
                    <div className="two-columns">
                      <Picker
                        label="Origen del creativo"
                        value={row.source}
                        onChange={(source) => update(row.key, { source })}
                        disabled={busy}
                        items={[
                          { id: "drive", name: "Link de Google Drive" },
                          { id: "upload", name: "Archivo de mi computadora" },
                          {
                            id: "existing",
                            name: "Creativo existente en Meta",
                          },
                        ]}
                      />
                      {row.source !== "existing" ? (
                        <Picker
                          label="Formato"
                          value={row.mediaType}
                          onChange={(mediaType) => update(row.key, { mediaType })}
                          disabled={busy}
                          items={[
                            { id: "image", name: "Imagen · JPG / PNG" },
                            { id: "video", name: "Video · MP4 / MOV" },
                          ]}
                        />
                      ) : (
                        <Picker
                          label="Anuncio modelo"
                          value={row.creative}
                          onChange={(creative) => update(row.key, { creative })}
                          disabled={busy || !targetSet}
                          items={ads.map((a) => ({
                            id: a.creative.id,
                            name: a.name,
                          }))}
                        />
                      )}
                    </div>
                    {row.source === "drive" && (
                      <label className="field">
                        <span>
                          <AppIcon icon={LinkIcon} size="secondary" /> Enlace del archivo
                        </span>
                        <input
                          value={row.drive}
                          onChange={(e) =>
                            update(row.key, {
                              drive: e.target.value,
                              resolvedDrive: undefined,
                              fileName: undefined,
                              ...(row.nameAuto ? { name: "" } : {}),
                            })
                          }
                          onBlur={() => nameFromDrive(row)}
                          placeholder="https://drive.google.com/file/d/…/view"
                          disabled={busy}
                        />
                        <small>Archivo accesible mediante enlace · hasta {mediaLimitMb()} MB. El nombre se completa al salir del campo.</small>
                      </label>
                    )}
                    {row.source === "upload" && (
                      <label className="upload-area">
                        <AppIcon icon={UploadCloud} />
                        <span>{row.fileName || "Elegir imagen o video"}</span>
                        <small>JPG, PNG, MP4 o MOV · hasta {mediaLimitMb()} MB</small>
                        <input type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime" disabled={busy} onChange={(e) => upload(row, e.target.files?.[0])} />
                      </label>
                    )}
                    {row.uploadError && (
                      <p className="error-detail" role="alert">
                        <AppIcon icon={AlertTriangle} size="secondary" />{row.uploadError} · Volvé a elegir el archivo para reintentar.
                      </p>
                    )}
                    {row.source !== "existing" && (
                      <label className="copy-toggle">
                        <Checkbox
                          checked={row.useCommon}
                          disabled={busy}
                          onCheckedChange={(value) => {
                            const useCommon = value === true;
                            update(row.key, {
                              useCommon,
                              ...(!useCommon ? resolveCopy(row, common) : {}),
                            });
                          }}
                        />
                        Usar texto común del lote
                      </label>
                    )}
                    {row.source !== "existing" && row.useCommon && (
                      <div className="inherited-copy">
                        <p>{common.message || "Completá el texto común arriba."}</p>
                        <small>
                          {common.title || "Sin título"} · {common.cta}
                        </small>
                        <span>{common.link || "Falta el enlace de destino"}</span>
                      </div>
                    )}
                    {row.source !== "existing" && !row.useCommon && (
                      <>
                        <label className="field">
                          <span>Texto principal</span>
                          <textarea value={row.message} onChange={(e) => update(row.key, { message: e.target.value })} placeholder="¿Qué querés contar?" disabled={busy} />
                        </label>
                        <div className="two-columns">
                          <label className="field">
                            <span>Título</span>
                            <input value={row.title} onChange={(e) => update(row.key, { title: e.target.value })} placeholder="Título del anuncio" disabled={busy} />
                          </label>
                          <label className="field">
                            <span>Enlace de destino</span>
                            <input value={row.link} onChange={(e) => update(row.key, { link: e.target.value })} placeholder="https://…" disabled={busy} />
                          </label>
                        </div>
                        <div className="two-columns">
                          <label className="field">
                            <span>Descripción</span>
                            <input value={row.description} disabled={busy} onChange={(e) => update(row.key, { description: e.target.value })} />
                          </label>
                          <label className="field">
                            <span>Parámetros de URL</span>
                            <input value={row.urlTags} disabled={busy} onChange={(e) => update(row.key, { urlTags: e.target.value })} />
                          </label>
                        </div>
                        <p className="helper">Botón heredado: {common.cta || "—"}</p>
                      </>
                    )}
                  </article>
                ))}
                <button className="add-row" onClick={() => setRows((prev) => [...prev, fresh()])} disabled={busy || rows.length >= 20}>
                  <AppIcon icon={PlusCircle} />
                  Agregar anuncio
                </button>
              </section>
            )}
          </div>
          <aside className="summary">
            <div className="summary-top">
              <span className="eyebrow">ANTES DE SUBIR</span>
              <h2>Tu carga, de un vistazo.</h2>
            </div>
            {mode === "campaign" ? (
              <dl>
                <dt>Cuenta</dt>
                <dd>{selectedAccount?.name || "Sin seleccionar"}</dd>
                <dt>Nueva campaña</dt>
                <dd>{build.name || "Sin nombre"}</dd>
                <dt>Modelo</dt>
                <dd>{buildSource?.name || "Sin seleccionar"}</dd>
                <dt>Objetivo</dt>
                <dd>{modelObjective.replace("OUTCOME_", "") || "—"}</dd>
                <dt>Conjuntos</dt>
                <dd>{groups.length || "—"}</dd>
                <dt>Presupuesto</dt>
                <dd>{build.cbo ? (build.budgetAmount ? `${money(String(moneyMinor(build.budgetAmount)))} ${build.budgetType === "daily" ? "por día" : "total"}` : "Sin monto") : build.adBudgetAmount ? `${money(String(moneyMinor(build.adBudgetAmount)))} por conjunto` : "Sin monto"}</dd>
              </dl>
            ) : (
              <dl>
                <dt>Cuenta</dt>
                <dd>{selectedAccount?.name || "Sin seleccionar"}</dd>
                <dt>{mode === "template" ? "Plantilla" : "Campaña"}</dt>
                <dd>{selectedCampaign?.name || "Sin seleccionar"}</dd>
                <dt>{mode === "template" ? "Nueva campaña" : "Conjunto"}</dt>
                <dd>{mode === "template" ? newName || "Sin nombre" : selectedSet?.name || "Sin seleccionar"}</dd>
                {mode === "existing" && <><dt>Crear en</dt><dd>{placement === "campaign" ? `${placementCampaignName || "Nueva campaña"} › ${placementGroups.length || 1} conjunto(s)` : placement === "adset" ? `${placementGroups.length || 1} conjunto(s) nuevo(s)` : distributionLabel}</dd><dt>Anuncio base</dt><dd>{baseAd?.name || "Sin seleccionar"}</dd></>}
                {mode === "template" && (
                  <>
                    <dt>Conjuntos a copiar</dt>
                    <dd>{templateSets.length} seleccionados</dd>
                  </>
                )}
              </dl>
            )}
            {mode !== "template" && (
              <div className="media-counts">
                <div>
                  <AppIcon icon={ImageIcon} />
                  <strong>{rows.filter((r) => r.source !== "existing" && r.mediaType === "image").length}</strong>
                  <span>imágenes</span>
                </div>
                <div>
                  <AppIcon icon={Video} />
                  <strong>{rows.filter((r) => r.source !== "existing" && r.mediaType === "video").length}</strong>
                  <span>videos</span>
                </div>
                <div>
                  <AppIcon icon={Layers} />
                  <strong>{rows.filter((r) => r.source === "existing").length}</strong>
                  <span>existentes</span>
                </div>
              </div>
            )}
            <div className="pause-note">
              <AppIcon icon={PauseCircle} />
              <p>
                Creación en pausa.
                <br />
                <span>La activación se hace en Ads Manager.</span>
              </p>
            </div>
            <button className="primary" disabled={!valid || busy} onClick={() => setReview(true)}>
              {busy ? (
                <>
                  <AppIcon icon={Loader2} className="spin" />
                  Procesando
                </>
              ) : (
                <>Revisar carga<AppIcon icon={ArrowRight} size="secondary" /></>
              )}
            </button>
            {busy && (
              <>
                <Progress value={queueProgress} />
                <button
                  className="text-button"
                  onClick={() => {
                    stop.current = true;
                  }}
                >
                  Detener después del paso actual
                </button>
              </>
            )}
            <p className="summary-foot">Una operación a la vez. Si Meta pide esperar, la carga hace una pausa.</p>
          </aside>
        </div>
        <section className="history" id="history">
          <div className="section-title">
            <h2>Últimas cargas</h2>
            <button className="text-button" onClick={refreshJobs}>
              <AppIcon icon={RefreshCw} size="secondary" />
              Actualizar
            </button>
          </div>
          {jobs.length === 0 ? (
            <div className="empty">
              <AppIcon icon={Layers3} size="large" />
              <div>
                <strong>Tu primera carga empieza acá.</strong>
                <p>El progreso y los IDs de Meta aparecerán en este historial.</p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobRuns.map((run) => {
                  const completed = run.jobs.filter((job) => job.status === "done").length;
                  const current = run.jobs.find((job) => job.status !== "done") || run.jobs[run.jobs.length - 1];
                  const expected = Number(run.plan?.payload.runTotal) || run.jobs.length;
                  const statusText = run.status === "done" ? "Carga completada" : run.status === "failed" ? "Carga con errores" : run.status === "uncertain" ? "Revisar en Meta" : run.status === "working" ? "En ejecución / verificar" : stageLabel[current?.state.stage] || "Pendiente";
                  return (
                  <TableRow key={run.id}>
                    <TableCell>
                      <strong>{run.name}</strong>
                      <small className="block">{new Date(run.created).toLocaleString("es-AR")}</small>
                    </TableCell>
                    <TableCell>
                      <span className={"status " + run.status}>{statusText}</span>
                      {current?.state.error && <p className="error-detail">{current.state.error}</p>}
                    </TableCell>
                    <TableCell>
                      <strong>{completed}/{expected}</strong>
                      <small className="block">operaciones completadas</small>
                    </TableCell>
                    <TableCell>
                      <details className="run-detail">
                        <summary>Ver detalle ({run.jobs.length})</summary>
                        <div className="run-jobs">
                          {run.jobs.sort((a, b) => (a.payload.runIndex || 0) - (b.payload.runIndex || 0)).map((j) => (
                            <div className="run-job" key={j.id}>
                              <strong>{j.payload.name}</strong>
                              <span className={"status " + j.status}>{j.status === "done" ? "Creado en pausa" : j.status === "failed" ? "Error" : j.status === "uncertain" ? "Revisar" : stageLabel[j.state.stage] || "Pendiente"}</span>
                              {(j.state.adId || j.state.adsetId || j.state.campaignId) && <small>ID: {j.state.adId || j.state.adsetId || j.state.campaignId}</small>}
                              {j.state.error && <p className="error-detail">{j.state.error}</p>}
                              {j.state.errorAction && <p className="error-action">{j.state.errorAction}</p>}
                              {j.state.trace && <small>Referencia Meta: {j.state.trace}</small>}
                              <div className="run-actions">
                                {isAttributionFailure(j) && <button className="text-button" disabled={busy || recoveryLoading} onClick={() => prepareRecovery(j)}>Recuperar con 1 día de clic</button>}
                                {(["ready", "waiting"].includes(j.status) || canResumeRejectedJob(j)) && <button className="text-button" disabled={busy} onClick={() => resume(j)}>Retomar</button>}
                                {j.kind === "campaign" && j.status === "done" && <button className="text-button" disabled={busy} onClick={() => resume(j)}>Cargar anuncios</button>}
                                {(j.state.adId || j.state.campaignId) && <a className="text-button" href={`https://adsmanager.facebook.com/adsmanager/manage/${j.state.adId ? "ads" : "campaigns"}?act=${j.payload.account.replace("act_", "")}&selected_${j.state.adId ? "ad" : "campaign"}_ids=${j.state.adId || j.state.campaignId}`} target="_blank" rel="noreferrer">Ver en Meta <AppIcon icon={ExternalLink} size="secondary" /></a>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </details>
                      {run.plan && (completed < expected || run.jobs.some((job) => job.status !== "done")) && (
                        <button className="text-button" disabled={busy} onClick={() => resumeRun(run)}>Retomar carga</button>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>
        <footer>
          OpenBulkAds <span>Open source · Marketing API v26.0</span>
        </footer>
      </SidebarInset>
      <Dialog
        open={connectionOpen}
        onOpenChange={(v) => {
          setConnectionOpen(v);
          if (!v) setToken("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectá tu cuenta de Meta</DialogTitle>
            <DialogDescription>Usá el token de usuario de tu app con ads_management y ads_read. Se guarda cifrado en el servidor.</DialogDescription>
          </DialogHeader>
          {notice && (
            <p className="helper" role="status">
              {notice}
            </p>
          )}
          <label className="field">
            <span>Token de usuario</span>
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pegá el token acá, no en el chat" />
          </label>
          <div className="token-details">
            <strong>{tokenLabel(metadata, clock)}</strong>
            {metadata?.expiresAt && <p>Token: {new Date(metadata.expiresAt).toLocaleString("es-AR")}</p>}
            {metadata?.dataAccessExpiresAt && <p>Acceso a datos: {new Date(metadata.dataAccessExpiresAt).toLocaleString("es-AR")}</p>}
            {metadata && <small>Última consulta: {new Date(metadata.checkedAt).toLocaleString("es-AR")}</small>}
          </div>
          <p className="helper">Con la clave de tu app configurada, los tokens que conectes se canjean automáticamente por uno de larga duración. Meta determina su vencimiento; un token vencido o invalidado requiere reconectar.</p>
          {connected && (
            <div className="token-actions">
              <button className="secondary-button" disabled={busy || !canExtend} onClick={() => tokenAction("inspect")}>
                Consultar vencimiento
              </button>
              <button className="secondary-button" disabled={busy || !canExtend} onClick={() => tokenAction("extend")}>
                Extender token
              </button>
            </div>
          )}
          {!canExtend && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setConnectionOpen(false);
                openConfig();
              }}
            >
              Configurar App ID y clave secreta
            </button>
          )}
          <button className="primary" onClick={connect} disabled={busy || !token}>
            Conectar y validar permisos
          </button>
          {connected && (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api("connection", { method: "DELETE" });
                  setConnected(false);
                  setMetadata(null);
                  setAccount("");
                  setAccounts([]);
                  setAvailableAccounts([]);
                  setConnectionOpen(false);
                } catch (e: any) {
                  setNotice(e.message);
                }
              }}
            >
              Desconectar y eliminar token
            </button>
          )}
          <a className="text-button" href="https://developers.facebook.com/tools/explorer/1638631194443006/" target="_blank" rel="noreferrer">
            Abrir Graph API Explorer
            <AppIcon icon={ExternalLink} size="secondary" />
          </a>
        </DialogContent>
      </Dialog>
      <Dialog
        open={configOpen}
        onOpenChange={(v) => {
          if (!busy) {
            setConfigOpen(v);
            if (!v) setAppSecret("");
          }
        }}
      >
        <DialogContent className="settings-dialog">
          <DialogHeader>
            <DialogTitle>Configuración</DialogTitle>
            <DialogDescription>Configurá tu app de Meta y elegí las cuentas que usás en este espacio.</DialogDescription>
          </DialogHeader>
          {notice && (
            <p className="helper" role="status">
              {notice}
            </p>
          )}
          <section>
            <h3>Token de Meta</h3>
            {connected && (
              <div className="token-details">
                <strong>{tokenLabel(metadata, clock)}</strong>
                {tokenDeadline(metadata) && <p>Vence: {new Date(tokenDeadline(metadata)!).toLocaleString("es-AR")}</p>}
              </div>
            )}
            <label className="field">
              <span>App ID</span>
              <input value={appId} onChange={(e) => setAppId(e.target.value)} disabled={busy} />
            </label>
            <label className="field">
              <span>Clave secreta de la app</span>
              <input type="password" autoComplete="new-password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder={hasSecret ? "Clave configurada · ingresá otra para reemplazarla" : "Pegá la clave acá, no en el chat"} disabled={busy} />
            </label>
            <p className="helper">Se guarda cifrada en el servidor. Para el canje usá un token generado por esta misma app.</p>
            <div className="token-actions">
              <button className="secondary-button" disabled={busy || !appSecret || !appId} onClick={saveCredentials}>
                Guardar clave
              </button>
              {connected && hasSecret && (
                <button className="secondary-button" disabled={busy} onClick={() => tokenAction("extend")}>
                  Extender token actual
                </button>
              )}
              {hasSecret && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api("settings", { method: "DELETE" });
                      setHasSecret(false);
                      setAppSecret("");
                      applyConnection(await api("connection"));
                    } catch (e: any) {
                      setNotice(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Eliminar clave guardada
                </button>
              )}
            </div>
          </section>
          <section>
            <h3>Cuentas de trabajo</h3>
            <p className="helper">Ocultar cuentas del selector no modifica tus permisos ni sus campañas.</p>
            {connected ? (
              <>
                <input className="account-search" value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="Buscar por nombre o ID" />
                <div className="token-actions">
                  <button className="text-button" disabled={busy} onClick={() => setChosenAccounts(null)}>
                    Todas las cuentas
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => setChosenAccounts([])}>
                    Ninguna
                  </button>
                  <button className="text-button" disabled={busy} onClick={() => loadAccounts().catch((e) => setNotice(e.message))}>
                    Actualizar lista
                  </button>
                </div>
                <div className="account-options">
                  {availableAccounts
                    .filter((a) => (a.name + " " + a.id).toLowerCase().includes(accountSearch.toLowerCase()))
                    .map((a) => (
                      <label key={a.id} className="account-option">
                        <Checkbox
                          disabled={busy}
                          checked={chosenAccounts === null || chosenAccounts.includes(a.id)}
                          onCheckedChange={(value) =>
                            setChosenAccounts((prev) => {
                              const current = prev === null ? availableAccounts.map((a) => a.id) : prev;
                              return value === true ? [...new Set([...current, a.id])] : current.filter((id) => id !== a.id);
                            })
                          }
                        />
                        <span>
                          <strong>{a.name}</strong>
                          <small>
                            {a.id}
                            {a.account_status !== 1 ? " · No activa" : ""}
                          </small>
                        </span>
                      </label>
                    ))}
                </div>
                <p className="helper">
                  {chosenAccounts === null ? availableAccounts.length : availableAccounts.filter((a) => chosenAccounts.includes(a.id)).length} de {availableAccounts.length} cuentas seleccionadas
                </p>
                <button className="primary" disabled={busy} onClick={saveAccounts}>
                  Guardar cuentas de trabajo
                </button>
              </>
            ) : (
              <p>Conectá Meta para elegir tus cuentas.</p>
            )}
          </section>
        </DialogContent>
      </Dialog>
      <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar preset para esta cuenta</DialogTitle>
            <DialogDescription>Guarda el anuncio base, sus textos, la estructura de destino y la distribución. Los archivos del lote no se incluyen.</DialogDescription>
          </DialogHeader>
          <label className="field">
            <span>Nombre del preset</span>
            <input value={presetName} disabled={busy} onChange={(e) => setPresetName(e.target.value)} placeholder="Ej. WhatsApp · Prueba gratuita" />
          </label>
          <button className="primary" disabled={busy || !presetName.trim()} onClick={savePreset}>
            Guardar preset
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(v) => {
          if (!v) setPreview(null);
        }}
      >
        <DialogContent className="creative-preview-dialog">
          <DialogHeader>
            <DialogTitle>{preview?.name || "Vista previa"}</DialogTitle>
            <DialogDescription>{preview?.fileName || "Creativo existente en Meta"}</DialogDescription>
          </DialogHeader>
          {/* Blob previews and Meta thumbnail URLs must retain their raw source. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview?.preview ? preview.mediaType === "video" ? <video controls src={preview.preview} className="creative-preview" /> : <img src={preview.preview} alt={preview.name} className="creative-preview" /> : preview && <img className="creative-preview" src={ads.find((a) => a.creative?.id === preview.creative)?.creative?.thumbnail_url} alt={preview.name} />}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(recovery)}
        onOpenChange={(v) => {
          if (!v && !busy) setRecovery(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Continuar la copia del conjunto</DialogTitle>
            <DialogDescription>Se creará un conjunto pausado dentro de la campaña que ya existe. La campaña y el conjunto originales quedan intactos.</DialogDescription>
          </DialogHeader>
          {recovery && (
            <div className="review-details">
              <p>
                <strong>Campaña de destino:</strong> {recovery.campaign.name} · {recovery.campaign.id}
              </p>
              <p>
                <strong>Conjunto:</strong> {recovery.sourceName}
              </p>
              <p>
                <strong>Atribución nueva:</strong> 1 día de clic, sin ventana de visualización.
              </p>
              {recovery.pageSource && <p>La Página se obtuvo de los creativos existentes del conjunto original.</p>}
              <p>Se reconstruye la configuración básica del conjunto porque Meta rechazó su copia directa. Revisá los valores que se enviarán.</p>
              <details>
                <summary>Ver configuración y atribución anterior</summary>
                <pre>
                  {JSON.stringify(
                    {
                      atribucionAnterior: recovery.previousAttribution,
                      configuracionNueva: recovery.params,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </div>
          )}
          <button className="primary" disabled={busy} onClick={recover}>
            Continuar en la campaña existente
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={review} onOpenChange={setReview}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "template" ? "Crear campaña desde plantilla" : mode === "campaign" ? "Crear campaña y conjuntos" : "Revisá antes de crear"}</DialogTitle>
            <DialogDescription>Esta acción crea objetos reales en Meta, todos en estado PAUSED.</DialogDescription>
          </DialogHeader>
          <div className="review-details">
            <p>
              <strong>Cuenta:</strong> {selectedAccount?.name}
            </p>
            <p>
              <strong>Campaña:</strong> {selectedCampaign?.name}
            </p>
            {mode === "campaign" ? (
              <>
                <p>
                  <strong>Nueva campaña:</strong> {build.name}
                </p>
                <p>
                  <strong>Objetivo:</strong> {modelObjective.replace("OUTCOME_", "") || "—"} (heredado del modelo)
                </p>
                <p>
                  <strong>Modelo:</strong> {buildSource?.name || "Sin seleccionar"}
                </p>
                {budgetLifetime && (
                  <p>
                    <strong>Programación:</strong> {build.startTime ? `inicio ${new Date(build.startTime).toLocaleString("es-AR")} · ` : ""}
                    fin {new Date(build.endTime).toLocaleString("es-AR")}
                  </p>
                )}
                <p>
                  {groups.length} conjuntos pausados: {groups.map((g) => g.name).join(", ")}
                </p>
                <p>
                  <strong>Presupuesto:</strong> {build.cbo ? (build.budgetAmount ? `${money(String(moneyMinor(build.budgetAmount)))} ${build.budgetType === "daily" ? "por día" : "total"} en la campaña` : "Sin presupuesto de campaña") : build.adBudgetAmount ? `${money(String(moneyMinor(build.adBudgetAmount)))} por conjunto` : "Sin presupuesto por conjunto"}
                </p>
                <p>El targeting hereda del modelo y aplica los países, la edad y el género indicados. La atribución se copia del modelo (o 1 día de clic si no la informa).</p>
                <p>Los anuncios se crean después, asignados a cada conjunto y en pausa.</p>
              </>
            ) : mode === "template" ? (
              <>
                <p>
                  <strong>Nueva campaña:</strong> {newName}
                </p>
                <p>{templateSets.length} conjuntos seleccionados, sin copiar anuncios.</p>
                <p>Si Meta exige atribución de 1 día para un conjunto de mensajes, se recreará su configuración básica con 1 día de clic y sin atribución por vista, dentro de esta campaña. Todos los objetos nuevos quedan pausados.</p>
                <p>
                  <strong>Presupuesto de campaña:</strong> {selectedCampaign?.daily_budget ? money(selectedCampaign.daily_budget) + " por día" : selectedCampaign?.lifetime_budget ? money(selectedCampaign.lifetime_budget) + " total" : "Por conjunto"}
                </p>
                {templateSets.map((s) => (
                  <p key={s.id}>
                    {s.name}: {s.daily_budget ? money(s.daily_budget) + " por día" : s.lifetime_budget ? money(s.lifetime_budget) + " total" : "presupuesto de campaña"}
                  </p>
                ))}
                <details>
                  <summary>Ver audiencia y configuración de los conjuntos</summary>
                  <pre>
                    {JSON.stringify(
                      templateSets.map((s) => ({
                        name: s.name,
                        targeting: s.targeting,
                        promoted_object: s.promoted_object,
                        optimization_goal: s.optimization_goal,
                        attribution_spec: s.attribution_spec,
                      })),
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </>
            ) : (
              <>
                <p>
                  <strong>Estructura:</strong> {placement === "campaign" ? `Nueva campaña “${placementCampaignName}” › ${placementGroups.length} conjunto(s) nuevo(s)` : placement === "adset" ? `Campaña “${selectedCampaign?.name}” › ${placementGroups.length} conjunto(s) nuevo(s)` : `Campaña existente con distribución ${distribution === "single" ? "en un conjunto" : distribution === "round-robin" ? "automática" : "manual"}`}
                </p>
                <p><strong>Base:</strong> {selectedCampaign?.name} › {selectedSet?.name} › {baseAd?.name}</p>
                <div className="plan-table-wrap">
                  <table className="plan-table">
                    <thead><tr><th>#</th><th>Anuncio</th><th>Campaña</th><th>Conjunto</th><th>Origen</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.key}>
                          <td>{i + 1}</td>
                          <td>{r.name}</td>
                          <td>{placement === "campaign" ? placementCampaignName : selectedCampaign?.name}</td>
                          <td>{placement === "campaign" || placement === "adset" ? placementGroupForRow(r)?.name || "Sin asignar" : sets.find((s) => s.id === targetAdsetForRow(r, i))?.name || "Sin asignar"}</td>
                          <td>{r.source === "existing" ? "Meta" : r.mediaType === "image" ? "Imagen" : "Video"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.map((r) => (
                  <div key={r.key} className="review-ad">
                    <p>
                      <AppIcon icon={CircleCheck} size="secondary" />
                      <strong>{r.name}</strong> · {r.source === "existing" ? "creativo existente" : r.mediaType === "image" ? "imagen" : "video"}
                    </p>
                    {r.source !== "existing" && (
                      <>
                        <p>{resolveCopy(r, common).message || "Sin texto principal"}</p>
                        <small>
                          {resolveCopy(r, common).title} · {resolveCopy(r, common).cta}
                        </small>
                        <p>{resolveCopy(r, common).link}</p>
                        <small>
                          {resolveCopy(r, common).description} {resolveCopy(r, common).urlTags}
                        </small>
                      </>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          <button className="primary" onClick={execute}>
            {mode === "template" ? "Crear campaña pausada" : mode === "campaign" ? `Crear ${groups.length} conjunto${groups.length === 1 ? "" : "s"} pausado${groups.length === 1 ? "" : "s"}` : placement === "campaign" ? `Crear campaña, ${placementGroups.length} conjunto${placementGroups.length === 1 ? "" : "s"} y ${rows.length} anuncio${rows.length === 1 ? "" : "s"}` : placement === "adset" ? `Crear ${placementGroups.length} conjunto${placementGroups.length === 1 ? "" : "s"} y ${rows.length} anuncio${rows.length === 1 ? "" : "s"}` : `Crear ${rows.length} anuncio${rows.length === 1 ? "" : "s"} en pausa`}
          </button>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
