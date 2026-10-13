import { recoverySource } from "@/lib/recovery-source";
import { repositories } from "@/lib/repositories";
import { selectTemplateSets } from "@/lib/template-selection";
import { canResumeRejectedJob } from "@/lib/media-retry";
import { RECOVERY_FIELDS, buildRecovery, canAutoRecover } from "@/lib/attribution-recovery";
import { CREATIVE_FIELDS, CTAS, campaignKind, describeModel, promotedObjectFromCreative, whatsappPhoneFromLink, isMetaCta, validateDestinationLink } from "@/lib/model";
import { buildCampaignParams, buildAdSetParams, validateSets, BID_STRATEGIES } from "@/lib/campaign-build";
import { z } from "zod";
import { owner, meta, json, fail, connection } from "@/lib/server";
import { mediaStore } from "@/lib/media/storage";
import { account, id, allPages, newStory, driveUrl, MetaError } from "@/lib/meta-core";
import { download, uploadMeta } from "@/lib/media";
import { jobErrorAction } from "@/lib/job-errors";
import { assertDraftParent } from "@/lib/draft-parent";
import { explainLeadTermsError, inspectLeadSetup, leadFormId, validateLeadSetup } from "@/lib/lead-form";
const identifier = z.string().regex(/^\d+$/);
const runFields = {
  runId: z.string().uuid().optional(),
  runName: z.string().trim().min(1).max(200).optional(),
  runIndex: z.number().int().min(1).max(50).optional(),
  runTotal: z.number().int().min(1).max(50).optional(),
};
const adSchema = z.object({
  ...runFields,
  kind: z.literal("ad"),
  account: z.string(),
  adset: identifier,
  name: z.string().trim().min(1).max(200),
  source: z.enum(["existing", "drive", "upload"]),
  creative: identifier.optional(),
  mediaType: z.enum(["image", "video"]).default("image"),
  drive: z.string().optional(),
  uploadKey: z.string().optional(),
  page: identifier.optional(),
  instagram: identifier.or(z.literal("")).optional(),
  message: z.string().max(5000).default(""),
  title: z.string().max(200).default(""),
  description: z.string().max(1000).default(""),
  urlTags: z.string().max(2048).default(""),
  model: identifier.optional(),
  link: z.string().optional(),
  cta: z.string().refine(isMetaCta, "Botón de Meta inválido.").default("LEARN_MORE"),
  targetGroup: z.string().max(200).optional(),
});
const templateSchema = z.object({
  ...runFields,
  kind: z.literal("template"),
  account: z.string(),
  campaign: identifier,
  name: z.string().trim().min(1).max(200),
  adsetIds: z.array(identifier).min(1).max(20).optional(),
  adsetName: z.string().trim().min(1).max(200).optional(),
});
const adsetCopySchema = z.object({
  ...runFields,
  kind: z.literal("adset-copy"),
  account: z.string(),
  campaign: identifier,
  adset: identifier,
  name: z.string().trim().min(1).max(200),
});
const runStructureGroupSchema = z.object({
  key: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  rowKeys: z.array(z.string().min(1).max(100)).max(50).optional(),
});
const runPlanSchema = z.object({
  ...runFields,
  kind: z.literal("run-plan"),
  account: z.string(),
  campaign: identifier,
  adset: identifier,
  placement: z.enum(["ads", "adset", "campaign"]),
  campaignName: z.string().trim().max(200).default(""),
  adsetName: z.string().trim().max(200).default(""),
  structureGroups: z.array(runStructureGroupSchema).max(20).optional(),
  ads: z.array(adSchema).min(1).max(20),
});
const targetingSchema = z.object({
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(300)
    .default([]),
  ageMin: z.number().int().min(18).max(65).nullable().default(null),
  ageMax: z.number().int().min(18).max(65).nullable().default(null),
  genders: z
    .array(z.union([z.literal(1), z.literal(2)]))
    .max(2)
    .default([]),
});
const campaignSetSchema = z.object({
  key: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  rowKeys: z.array(z.string().min(1).max(100)).max(50).optional(),
});
const campaignSchema = z.object({
  ...runFields,
  kind: z.literal("campaign"),
  account: z.string(),
  modelAdset: identifier,
  creativeModel: identifier.optional(),
  name: z.string().trim().min(1).max(200),
  cbo: z.boolean().default(false),
  budgetType: z.enum(["daily", "lifetime"]).default("daily"),
  budgetAmount: z.number().int().min(0).default(0),
  bidStrategy: z.enum(BID_STRATEGIES as [string, ...string[]]).default("LOWEST_COST_WITHOUT_CAP"),
  bidAmount: z.number().int().min(0).default(0),
  adBudgetType: z.enum(["daily", "lifetime"]).default("daily"),
  adBudgetAmount: z.number().int().min(0).default(0),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  targeting: targetingSchema.optional(),
  sets: z.array(campaignSetSchema).min(1).max(20),
});
export async function GET(r: Request) {
  try {
    const user = await owner(r),
      results = await (await repositories()).jobs.list(user);
    return json({
      data: results.map((row) => ({
        ...row,
        state: JSON.parse(row.state),
        payload: JSON.parse(row.payload),
      })),
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(r: Request) {
  try {
    const user = await owner(r, true),
      input: any = await r.json(),
      call = await meta(user);
    const p: any = input.kind === "campaign" ? campaignSchema.parse(input) : input.kind === "template" ? templateSchema.parse(input) : input.kind === "adset-copy" ? adsetCopySchema.parse(input) : input.kind === "run-plan" ? runPlanSchema.parse(input) : adSchema.parse(input);
    p.account = account(p.account);
    let state: any = {}, initialStatus = "ready";
    if (p.kind === "run-plan") {
      state = { stage: "planned" };
      initialStatus = "done";
    } else if (p.kind === "campaign") {
      let m = await call(p.modelAdset, { fields: RECOVERY_FIELDS });
      if (account(m.account_id) !== p.account) throw new Error("El conjunto modelo pertenece a otra cuenta.");
      const mc = await call(m.campaign_id, {
        fields: "id,account_id,status,objective,daily_budget,lifetime_budget,special_ad_categories",
      });
      if (account(mc.account_id) !== p.account) throw new Error("La campaña del conjunto modelo pertenece a otra cuenta.");
      if (mc.status === "ARCHIVED") throw new Error("La campaña modelo está archivada. Elegí otra.");
      if (p.creativeModel) {
        const c = await call(p.creativeModel, { fields: CREATIVE_FIELDS });
        if (account(c.account_id) !== p.account) throw new Error("El creativo modelo pertenece a otra cuenta.");
        const creative = describeModel(c);
        if (!creative.supported) throw new Error("El creativo modelo no tiene una estructura básica compatible.");
        if (m.promoted_object?.page_id && creative.page !== m.promoted_object.page_id) throw new Error("La Página del creativo modelo no coincide con el conjunto modelo.");
        if (!m.promoted_object && ["WHATSAPP", "INSTAGRAM_DIRECT", "MESSENGER"].includes(m.destination_type)) {
          m.promoted_object = promotedObjectFromCreative(m.destination_type, creative);
          m.recovery_page_source = "creative_model";
        }
      } else if (!m.promoted_object && ["WHATSAPP", "INSTAGRAM_DIRECT", "MESSENGER"].includes(m.destination_type)) m = await recoverySource(call, p.modelAdset);
      p.sets = validateSets(p.sets);
      buildCampaignParams(p, mc);
      buildAdSetParams(p, m, "0", p.name);
      state = {
        stage: "create_campaign",
        model: m,
        modelCampaign: mc,
        sets: p.sets,
        createdSets: [],
      };
    } else if (p.kind === "template") {
      const c = await call(id(p.campaign), {
        fields: "id,account_id,name,status,objective,daily_budget,lifetime_budget,special_ad_categories",
      });
      if (account(c.account_id) !== p.account) throw new Error("La plantilla debe ser de la cuenta seleccionada.");
      const sets = await allPages((q) => call(p.campaign + "/adsets", q), {
        fields: "id,name",
      });
      const selected = selectTemplateSets(sets, p.adsetIds);
      if (p.adsetIds !== undefined) p.adsetIds = selected.ids;
      state = {
        stage: "copy_campaign",
        sets: selected.sets,
        copiedSets: [],
        template: c,
        autoAttribution: true,
      };
    } else if (p.kind === "adset-copy") {
      const source = await call(p.adset, { fields: "id,account_id,campaign_id,name,status" });
      const target = await call(p.campaign, { fields: "id,account_id,status" });
      if (account(source.account_id) !== p.account || account(target.account_id) !== p.account) throw new Error("La campaña y el conjunto base deben pertenecer a la cuenta seleccionada.");
      assertDraftParent("campaign", target.status);
      state = { stage: "copy_adset", source };
    } else {
      const set = await call(p.adset, {
        fields: "id,account_id,campaign_id,status,effective_status,destination_type,promoted_object",
      });
      if (account(set.account_id) !== p.account) throw new Error("El conjunto no pertenece a la cuenta seleccionada.");
      assertDraftParent("adset", set.status);
      state = {
        stage: p.source === "existing" ? "ad" : "prepare",
        destination: set.destination_type,
      };
      if (p.source === "existing") {
        if (!p.creative) throw new Error("Seleccioná un creativo existente.");
        const c = await call(p.creative, { fields: "id,account_id" });
        if (account(c.account_id) !== p.account) throw new Error("El creativo pertenece a otra cuenta.");
        state.creativeId = p.creative;
      } else {
        if (!p.model) throw new Error("Elegí un anuncio base. Su formulario, mensajería o conversión se hereda automáticamente.");
        if (!p.page) throw new Error("Falta el ID de la Página.");
        if (set.promoted_object?.page_id && set.promoted_object.page_id !== p.page) throw new Error("La Página no coincide con el conjunto.");
        if (set.destination_type === "WHATSAPP" && p.cta !== "WHATSAPP_MESSAGE") throw new Error("WhatsApp requiere el botón Enviar mensaje por WhatsApp del anuncio base.");
        const suppliedWhatsApp = whatsappPhoneFromLink(p.link || "");
        if (set.destination_type === "WHATSAPP" && suppliedWhatsApp && set.promoted_object?.whatsapp_phone_number && suppliedWhatsApp !== set.promoted_object.whatsapp_phone_number.replace(/\D/g, "")) throw new Error("El número de WhatsApp debe coincidir con el conjunto.");
        if (set.destination_type === "INSTAGRAM_DIRECT" && (!p.instagram || p.cta !== "INSTAGRAM_MESSAGE")) throw new Error("Instagram Direct requiere ID de Instagram y botón de mensaje.");
        const c = await call(p.model, { fields: CREATIVE_FIELDS });
        if (account(c.account_id) !== p.account) throw new Error("El anuncio base debe pertenecer a la misma cuenta.");
        const model = describeModel(c);
        if (!model.supported) throw new Error(model.reason);
        if (p.cta !== model.copy.cta && !(CTAS as readonly string[]).includes(p.cta)) throw new Error("El botón debe heredarse del anuncio base o ser una opción compatible de OpenBulkAds.");
        if (model.page !== p.page || (model.instagram && model.instagram !== p.instagram)) throw new Error("La identidad debe coincidir con el anuncio base.");
        const expectedKind = campaignKind(set.destination_type, model);
        if (expectedKind === "UNSUPPORTED") throw new Error(`El destino ${set.destination_type || "desconocido"} todavía no está cubierto por la carga rápida.`);
        validateDestinationLink(expectedKind, p.link || "");
        if (expectedKind === "WHATSAPP" && p.cta !== "WHATSAPP_MESSAGE") throw new Error("WhatsApp requiere el botón Enviar mensaje por WhatsApp del anuncio base.");
        if (expectedKind === "WHATSAPP" && suppliedWhatsApp && set.promoted_object?.whatsapp_phone_number && suppliedWhatsApp !== set.promoted_object.whatsapp_phone_number.replace(/\D/g, "")) throw new Error("El número de WhatsApp debe coincidir con el conjunto.");
        if (expectedKind === "INSTAGRAM_DIRECT" && (!p.instagram || p.cta !== "INSTAGRAM_MESSAGE")) throw new Error("Instagram Direct requiere ID de Instagram y botón de mensaje.");
        if (expectedKind === "WHATSAPP" && model.copy.cta !== "WHATSAPP_MESSAGE") throw new Error("El anuncio base no contiene una plantilla válida de WhatsApp.");
        if (expectedKind === "INSTAGRAM_DIRECT" && model.copy.cta !== "INSTAGRAM_MESSAGE") throw new Error("El anuncio base no contiene una plantilla válida de Instagram DM.");
        if (expectedKind === "MESSENGER" && !["MESSAGE_PAGE", "SEND_MESSAGE"].includes(model.copy.cta)) throw new Error("El anuncio base no contiene una plantilla válida de Facebook Messages.");
        state.model = model;
        state.campaignKind = expectedKind;
        if (expectedKind === "LEAD_FORM") {
          state.leadSetup = await inspectLeadSetup(call, p.page, leadFormId(model));
          validateLeadSetup(state.leadSetup);
        }
        if (p.source === "drive") driveUrl(p.drive || "");
        if (p.source === "upload" && (!p.uploadKey?.startsWith(user + "/") || !(await (await mediaStore()).head(p.uploadKey)))) throw new Error("Subí un archivo primero.");
      }
    }
    const canonical = JSON.stringify(p),
      identityPayload = { ...p };
    delete identityPayload.runName;
    delete identityPayload.runIndex;
    delete identityPayload.runTotal;
    if (!identityPayload.description) delete identityPayload.description;
    if (!identityPayload.urlTags) delete identityPayload.urlTags;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(user + JSON.stringify(identityPayload)))))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const now = Date.now();
    const result = await (await repositories()).jobs.create({ id: hash, owner: user, kind: p.kind, payload: canonical, state: JSON.stringify(state), status: initialStatus, created: now, updated: now });
    if (result.kind === 'conflict') throw new Error('Trabajo existente de otro usuario.');
    const { id: savedId, status, state: savedState } = result.job;
    return json({ id: savedId, status, state: JSON.parse(savedState) });
  } catch (e) {
    return fail(e);
  }
}
export async function PATCH(r: Request) {
  let job: any,
    user = "",
    original: any,
    mutation = false,
    currentState: any;
  try {
    user = await owner(r, true);
    const { jobId, retryPreparation } = (await r.json()) as any;
    if (typeof jobId !== "string" || !/^[a-f0-9]{64}$/.test(jobId)) throw new Error("Trabajo inválido.");
    const jobs = (await repositories()).jobs;
    job = await jobs.get(jobId, user);
    if (!job) throw new Error("Trabajo inexistente.");
    if (retryPreparation === true) {
      if (job.status !== 'failed' || !canResumeRejectedJob({ ...job, state: JSON.parse(job.state) })) throw new Error("Este error no permite retomar automáticamente. Revisá el historial.");
      if (!await jobs.prepareRetry(job.id, user, Date.now())) throw new Error("El trabajo ya cambió de estado.");
      job.status = "ready";
    }
    if (!["ready", "waiting"].includes(job.status)) return json({ ...job, state: JSON.parse(job.state) });
    const call = await meta(user),
      c = await connection(user);
    if (c.cooldown > Date.now()) throw new MetaError("Meta necesita una pausa.", 429, "", false, Math.ceil((c.cooldown - Date.now()) / 1000));
    const claimed = await jobs.claim(job.id, user, Date.now());
    if (claimed.kind !== 'claimed') throw new Error("Este trabajo ya está en ejecución.");
    job = claimed.job;
    const p = JSON.parse(job.payload),
      s = JSON.parse(job.state);
    original = structuredClone(s);
    currentState = s;
    delete s.error;
    delete s.trace;
    delete s.wait;
    mutation = ["copy_campaign", "rename", "copy_sets", "rename_copied_set", "copy_adset", "rename_adset", "upload", "creative", "ad", "create_campaign", "create_sets"].includes(s.stage);
    let status = "ready";
    if (job.kind === "campaign") {
      if (s.stage === "create_campaign") {
        mutation = true;
        const params = buildCampaignParams(p, s.modelCampaign);
        const v = await call(p.account + "/campaigns", params, "POST");
        s.campaignId = v.id;
        if (!s.campaignId) throw new MetaError("Meta no devolvió el ID de la campaña.", 0, "", true);
        s.stage = "create_sets";
      } else if (s.stage === "create_sets") {
        mutation = false;
        const target = s.sets[s.createdSets.length];
        if (!target) throw new Error("La estructura de conjuntos está vacía.");
        const params = buildAdSetParams(p, s.model, s.campaignId, target.name);
        mutation = true;
        const v = await call(p.account + "/adsets", params, "POST");
        const newId = v.id;
        if (!newId) throw new MetaError("Meta no devolvió el ID del conjunto.", 0, "", true);
        s.createdSets.push({ id: newId, key: target.key, name: target.name });
        if (s.createdSets.length === s.sets.length) s.stage = "verify_campaign";
      } else if (s.stage === "verify_campaign") {
        const v = await call(s.campaignId, {
          fields: "id,name,status,adsets{id,name,status}",
        });
        if (v.status !== "PAUSED" || v.adsets?.data?.some((a: any) => a.status !== "PAUSED")) throw new Error("Revisá los estados de la campaña en Ads Manager.");
        s.stage = "done";
        status = "done";
      }
    } else if (job.kind === "template") {
      if (s.stage === "copy_campaign") {
        const v = await call(p.campaign + "/copies", { deep_copy: false, status_option: "PAUSED" }, "POST");
        s.campaignId = v.copied_campaign_id || v.id;
        if (!s.campaignId) throw new MetaError("Meta no devolvió el ID de campaña copiada.", 0, "", true);
        s.stage = "rename";
      } else if (s.stage === "rename") {
        await call(s.campaignId, { name: p.name, status: "PAUSED" }, "POST");
        s.stage = "copy_sets";
      } else if (s.stage === "copy_sets") {
        mutation = false;
        const source = s.sets[s.copiedSets.length];
        const recovery = s.attributionRecovery;
        if (recovery && recovery.sourceId !== source.id) throw new Error("El conjunto a recuperar no coincide con el paso pendiente.");
        if (recovery) {
          const target = await call(s.campaignId, {
            fields: "id,status,account_id",
          });
          if (target.status !== "PAUSED" || account(target.account_id) !== p.account) throw new Error("La campaña de destino debe seguir pausada y pertenecer a la misma cuenta.");
        }
        let v: any;
        if (recovery) {
          mutation = true;
          v = await call(p.account + "/adsets", { ...recovery.params, campaign_id: s.campaignId, status: "PAUSED" }, "POST");
        } else {
          try {
            mutation = true;
            v = await call(
              source.id + "/copies",
              {
                campaign_id: s.campaignId,
                deep_copy: false,
                status_option: "PAUSED",
              },
              "POST",
            );
          } catch (e) {
            const error = e as MetaError;
            if (!canAutoRecover(s, error)) throw e;
            mutation = false;
            s.attributionRejected = {
              sourceId: source.id,
              message: error.message,
              trace: error.trace,
            };
            const reference = await recoverySource(call, source.id),
              target = await call(s.campaignId, {
                fields: "id,status,account_id,daily_budget,lifetime_budget",
              });
            if (account(reference.account_id) !== p.account || reference.campaign_id !== p.campaign || account(target.account_id) !== p.account) throw new MetaError("La configuración de origen o destino no coincide con la cuenta.", 100, "", false);
            const params = buildRecovery(reference, target);
            s.attributionRecovery = { sourceId: source.id, params };
            s.note = "Meta rechazó la atribución original. Se continuará con 1 día de clic en el conjunto nuevo.";
            if (!await jobs.update(job.id, user, { state: JSON.stringify(s), status: 'ready', updated: Date.now(), expectedStatuses: ['working'] })) throw new Error('El trabajo ya cambió de estado.');
            return json({ id: job.id, status: "ready", state: s });
          }
        }
        const newId = v.copied_adset_id || v.id;
        if (!newId) throw new MetaError("Meta no devolvió el ID de conjunto copiado.", 0, "", true);
        s.copiedSets.push({
          id: newId,
          name: source.name,
          ...(recovery ? { attributionAdjusted: true } : {}),
        });
        delete s.attributionRecovery;
        delete s.attributionRejected;
        if (s.copiedSets.length === s.sets.length) s.stage = p.adsetName && s.copiedSets.length === 1 ? "rename_copied_set" : "verify_template";
      } else if (s.stage === "rename_copied_set") {
        await call(s.copiedSets[0].id, { name: p.adsetName, status: "PAUSED" }, "POST");
        s.copiedSets[0].name = p.adsetName;
        s.stage = "verify_template";
      } else if (s.stage === "verify_template") {
        const v = await call(s.campaignId, {
          fields: "id,name,status,adsets{id,name,status}",
        });
        if (v.status !== "PAUSED" || v.adsets?.data?.some((a: any) => a.status !== "PAUSED")) throw new Error("Revisá los estados de la plantilla en Ads Manager.");
        s.stage = "done";
        status = "done";
      }
    } else if (job.kind === "adset-copy") {
      if (s.stage === "copy_adset") {
        let v: any;
        try {
          mutation = true;
          v = await call(p.adset + "/copies", { campaign_id: p.campaign, deep_copy: false, status_option: "PAUSED" }, "POST");
        } catch (e) {
          const error = e as MetaError;
          const recoverable = !error.ambiguous && !error.wait && /atribuci[oó]n|attribution/i.test(error.message) && /1\s*d[ií]a|1\s*day/i.test(error.message);
          if (!recoverable) throw e;
          mutation = false;
          const reference = await recoverySource(call, p.adset), target = await call(p.campaign, { fields: "id,status,account_id,daily_budget,lifetime_budget" });
          if (account(reference.account_id) !== p.account || account(target.account_id) !== p.account) throw new MetaError("La configuración de origen o destino no coincide con la cuenta.", 100, "", false);
          const params = buildRecovery(reference, target, { allowActiveCampaign: true });
          mutation = true;
          v = await call(p.account + "/adsets", { ...params, name: p.name }, "POST");
          s.attributionAdjusted = true;
        }
        s.adsetId = v.copied_adset_id || v.id;
        if (!s.adsetId) throw new MetaError("Meta no devolvió el ID del conjunto copiado.", 0, "", true);
        s.stage = "rename_adset";
      } else if (s.stage === "rename_adset") {
        await call(s.adsetId, { name: p.name, status: "PAUSED" }, "POST");
        s.stage = "verify_adset";
      } else if (s.stage === "verify_adset") {
        const v = await call(s.adsetId, { fields: "id,name,status,campaign_id" });
        if (v.status !== "PAUSED" || v.campaign_id !== p.campaign) throw new Error("Revisá el conjunto nuevo en Ads Manager.");
        s.stage = "done";
        status = "done";
      }
    } else {
      if (s.stage === "prepare") {
        s.key = p.source === "upload" ? p.uploadKey : await download(user, p.drive);
        const object = await (await mediaStore()).get(s.key);
        if (!object) throw new Error("Archivo no disponible.");
        const reader = object.body.getReader(),
          first = await reader.read();
        await reader.cancel();
        const bytes = first.value || new Uint8Array();
        const image = (bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71);
        const video = new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
        if ((p.mediaType === "image" && !image) || (p.mediaType === "video" && !video)) throw new Error("El contenido del archivo no coincide con el tipo elegido (JPG/PNG o MP4/MOV).");
        s.stage = "upload";
      } else if (s.stage === "upload") {
        const v = await uploadMeta(user, p.account, s.key, p.mediaType);
        if (p.mediaType === "image") {
          s.imageHash = (Object.values(v.images || {})[0] as any)?.hash;
          if (!s.imageHash) throw new MetaError("Meta no devolvió el hash de la imagen.", 0, "", true);
          s.stage = "creative";
        } else {
          s.videoId = v.id;
          if (!s.videoId) throw new MetaError("Meta no devolvió el ID del video.", 0, "", true);
          s.stage = "video";
        }
      } else if (s.stage === "video") {
        const v = await call(s.videoId, {
          fields: "id,status,thumbnails{uri,is_preferred}",
        });
        if (v.status?.video_status === "error") throw new Error("Meta no pudo procesar el video.");
        const thumb = v.thumbnails?.data?.find((t: any) => t.is_preferred) || v.thumbnails?.data?.[0];
        if (v.status?.video_status !== "ready" || !thumb) {
          status = "waiting";
          s.note = "Meta está procesando el video.";
        } else {
          s.thumbnail = thumb.uri;
          s.stage = "creative";
          delete s.note;
        }
      } else if (s.stage === "creative") {
        if (s.campaignKind === "LEAD_FORM") {
          s.leadSetup = await inspectLeadSetup(call, p.page, leadFormId(s.model));
          validateLeadSetup(s.leadSetup);
        }
        let v: any;
        try {
          v = await call(
            p.account + "/adcreatives",
            {
              name: p.name,
              object_story_spec: newStory(p, s),
              ...(p.urlTags ? { url_tags: p.urlTags } : {}),
            },
            "POST",
          );
        } catch (error) {
          throw s.campaignKind === "LEAD_FORM" && s.leadSetup
            ? explainLeadTermsError(error, s.leadSetup)
            : error;
        }
        if (!v.id) throw new MetaError("Meta no devolvió el ID del creativo.", 0, "", true);
        s.creativeId = v.id;
        s.stage = "ad";
      } else if (s.stage === "ad") {
        if (s.campaignKind === "LEAD_FORM") {
          s.leadSetup = await inspectLeadSetup(call, p.page, leadFormId(s.model));
          validateLeadSetup(s.leadSetup);
        }
        let v: any;
        try {
          v = await call(
            p.account + "/ads",
            {
              name: p.name,
              adset_id: p.adset,
              creative: { creative_id: s.creativeId },
              status: "PAUSED",
            },
            "POST",
          );
        } catch (error) {
          throw s.campaignKind === "LEAD_FORM" && s.leadSetup
            ? explainLeadTermsError(error, s.leadSetup)
            : error;
        }
        if (!v.id) throw new MetaError("Meta no devolvió el ID del anuncio.", 0, "", true);
        s.adId = v.id;
        s.stage = "verify";
      } else if (s.stage === "verify") {
        const v = await call(s.adId, { fields: "id,status,effective_status" });
        s.metaStatus = v.status;
        s.effectiveStatus = v.effective_status;
        if (v.status !== "PAUSED") throw new Error("Revisá el estado del anuncio en Ads Manager.");
        s.stage = "done";
        status = "done";
      }
    }
    if (!await jobs.update(job.id, user, { state: JSON.stringify(s), status, updated: Date.now(), expectedStatuses: ['working'] })) throw new Error('El trabajo ya cambió de estado.');
    if (status === "done" && s.key) await mediaStore().then(store => store.delete(s.key!)).catch(() => {});
    return json({ id: job.id, status, state: s });
  } catch (e) {
    const error = e as MetaError;
    if (job && original) {
      const status = error.ambiguous || (mutation && !(error instanceof MetaError)) ? "uncertain" : error.wait ? "waiting" : "failed";
      const state = {
        ...(currentState || original),
        error: error.message,
        errorAction: jobErrorAction((currentState || original)?.stage, status === "uncertain"),
        trace: error.trace,
        wait: error.wait,
      };
      if (!await (await repositories()).jobs.update(job.id, user, { state: JSON.stringify(state), status, updated: Date.now(), expectedStatuses: ['working'] })) return fail(new Error('El trabajo ya cambió de estado.'));
      return json({ id: job.id, status, state });
    }
    return fail(e);
  }
}
