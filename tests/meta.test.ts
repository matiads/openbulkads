import { test } from "node:test";
import assert from "node:assert/strict";
import { graph, driveUrl, usageWait, newStory, MetaError } from "../lib/meta-core";
import { DEFAULT_MEDIA_LIMIT_MB, MAX_MEDIA_BYTES, mediaLimitMb, parseMediaLimitMb, isWithinMediaLimit, oversizeMessage, fileSizeRangeMessage, uploadTooLargeMessage } from "../lib/media-limit";
test("Drive accepts file links and rejects arbitrary network destinations", () => {
  assert.match(driveUrl("https://drive.google.com/file/d/abcdefghijkl/view?resourcekey=abc"), /id=abcdefghijkl&resourcekey=abc/);
  for (const url of ["http://drive.google.com/file/d/abcdefghijkl", "https://localhost/file/d/abcdefghijkl", "https://drive.google.com/drive/folders/abcdefghijkl"]) assert.throws(() => driveUrl(url));
  for (const path of ["/tmp/herdr-clipboard-images-1000/client-424-clipboard-1791857999443083440-0.png", "C:\\Users\\x\\pic.png", "file:///tmp/x.png"]) {
    assert.throws(() => driveUrl(path), /ruta de archivo local|Google Drive/);
  }
});
test("Rate telemetry respects reported recovery time and usage threshold", () => {
  assert.equal(
    usageWait(
      new Headers({
        "x-business-use-case-usage": JSON.stringify({
          "123": [{ call_count: 85, estimated_time_to_regain_access: 3 }],
        }),
      }),
    ),
    180,
  );
  assert.equal(usageWait(new Headers({ "x-app-usage": '{"call_count":10}' })), 0);
});
test("A POST with an unknown outcome is never automatically retried", async () => {
  const old = globalThis.fetch;
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    throw new Error("network reset");
  };
  try {
    await assert.rejects(graph("fake-token", "act_123/ads", { status: "PAUSED" }, "POST"), (e: any) => e.ambiguous === true);
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = old;
  }
});
test("Explicit Meta rejection retains diagnostic and requests a pause", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: 4, message: "Rate limit", fbtrace_id: "trace" } }, { status: 429 });
  let wait = 0;
  try {
    await assert.rejects(
      graph("fake-token", "act_123/ads", {}, "POST", async (s) => {
        wait = s;
      }),
      (e: any) => e.wait >= 60 && e.ambiguous === false && e.trace === "trace",
    );
    assert.equal(wait, 60);
  } finally {
    globalThis.fetch = old;
  }
});
test("Image and video creatives use the requested media without changing identity", () => {
  const p = {
    page: "123",
    instagram: "456",
    cta: "WHATSAPP_MESSAGE",
    link: "https://wa.me/123",
    message: "Hola",
    title: "Prueba",
    mediaType: "image",
  };
  assert.equal(newStory(p, { imageHash: "hash" }).link_data.image_hash, "hash");
  assert.equal(newStory({ ...p, mediaType: "video" }, { videoId: "789", thumbnail: "https://example.com/thumbnail.jpg" }).video_data.video_id, "789");
});
import { emptyCopy, resolveCopy, supportedFile, driveLines } from "../lib/batch-core";
import { describeModel, modelStory, promotedObjectFromCreative, campaignKind, campaignKindLabel, whatsappPhoneFromLink, whatsappPhoneFromCreative, CTAS, isMetaCta, validateDestinationLink } from "../lib/model";
test("Common copy remains live while per-ad exceptions stay independent", () => {
  const common = {
    ...emptyCopy(),
    message: "Común",
    title: "Título",
    link: "https://example.com",
  };
  const inherited = { useCommon: true, message: "Viejo" };
  const overridden = {
    useCommon: false,
    message: "Individual",
    title: "Otro",
    description: "",
    link: "https://other.example",
    urlTags: "",
    cta: "SHOP_NOW",
  };
  assert.equal(resolveCopy(inherited, common).message, "Común");
  const changed = { ...common, message: "Nuevo" };
  assert.equal(resolveCopy(inherited, changed).message, "Nuevo");
  assert.equal(resolveCopy(overridden, changed).message, "Individual");
  assert.equal(resolveCopy(overridden, changed).cta, "SHOP_NOW");
});
test("Batch import refuses invalid files and excess links before preparing rows", () => {
  assert.equal(supportedFile({ name: "a.mp4", type: "", size: 10 }).mediaType, "video");
  assert.throws(() =>
    supportedFile({
      name: "large.jpg",
      type: "image/jpeg",
      size: MAX_MEDIA_BYTES + 1,
    }),
  );
  assert.throws(() => supportedFile({ name: "script.svg", type: "image/svg+xml", size: 100 }));
  assert.throws(() => driveLines("https://drive.google.com/file/d/abcdefghijkl/view\nhttps://drive.google.com/file/d/123456789abc/view", 1));
  assert.throws(() => driveLines("/tmp/pasted.png", 5), /ruta de archivo local/);
  assert.equal(driveLines("https://drive.google.com/file/d/abcdefghijkl/view", 1).length, 1);
});
test("Empty and oversized uploads stay rejected while the documented 250 MB cap remains", () => {
  assert.throws(() => supportedFile({ name: "vacio.jpg", type: "image/jpeg", size: 0 }), /vacio\.jpg: el archivo debe pesar entre 1 byte y 250 MB/);
  assert.throws(() => supportedFile({ name: "grande.jpg", type: "image/jpeg", size: MAX_MEDIA_BYTES + 1 }), /grande\.jpg: el archivo debe pesar entre 1 byte y 250 MB/);
  assert.equal(supportedFile({ name: "limite.jpg", type: "image/jpeg", size: MAX_MEDIA_BYTES }).mediaType, "image");
});
test("One media-limit contract defaults to 250 MB and reports it in every message", () => {
  assert.equal(DEFAULT_MEDIA_LIMIT_MB, 250);
  assert.equal(MAX_MEDIA_BYTES, 250 * 1024 * 1024);
  assert.equal(mediaLimitMb(), 250);
  assert.equal(oversizeMessage(), "El archivo supera 250 MB.");
  assert.equal(fileSizeRangeMessage("grande.jpg"), "grande.jpg: el archivo debe pesar entre 1 byte y 250 MB.");
  assert.equal(uploadTooLargeMessage(), "El archivo debe pesar menos de 250 MB.");
});
test("Media-limit parsing accepts positive whole megabytes and fails safe otherwise", () => {
  assert.equal(parseMediaLimitMb("300"), 300);
  assert.equal(parseMediaLimitMb(" 250 "), 250);
  for (const raw of [undefined, null, "", "   ", "0", "-1", "abc", "250.5", "1e3", "Infinity", "NaN", "99999999999999999999"]) {
    assert.equal(parseMediaLimitMb(raw as string | undefined | null), DEFAULT_MEDIA_LIMIT_MB, `invalid value ${String(raw)} must fall back to ${DEFAULT_MEDIA_LIMIT_MB}`);
  }
});
test("Media-limit boundaries reject zero and limit+1 while accepting exactly the limit", () => {
  assert.equal(isWithinMediaLimit(0), false);
  assert.equal(isWithinMediaLimit(MAX_MEDIA_BYTES), true);
  assert.equal(isWithinMediaLimit(MAX_MEDIA_BYTES + 1), false);
});
test("Model replaces media and copy, preserves message settings and leaves source untouched", () => {
  const original = {
    id: "1",
    object_story_spec: {
      page_id: "123",
      instagram_user_id: "456",
      link_data: {
        image_hash: "old",
        image_crops: { old: true },
        message: "Old",
        name: "Old",
        link: "https://old.example",
        page_welcome_message: "welcome",
        post_click_configuration: { whatsapp_business_number: "5491112345678" },
        call_to_action: {
          type: "WHATSAPP_MESSAGE",
          value: { link: "https://old.example" },
        },
      },
    },
  };
  const snapshot = JSON.stringify(original);
  const model = describeModel(original);
  assert.equal(model.supported, true);
  const p = {
    page: "123",
    instagram: "456",
    message: "New",
    title: "New title",
    description: "Description",
    link: "https://wa.me/123",
    cta: "WHATSAPP_MESSAGE",
    mediaType: "video",
  };
  const story = modelStory(p, {
    model,
    videoId: "789",
    thumbnail: "https://example.com/thumb",
  });
  assert.equal(story.video_data.video_id, "789");
  assert.equal(story.video_data.page_welcome_message, "welcome");
  assert.equal(story.video_data.post_click_configuration.whatsapp_business_number, "5491112345678");
  assert.equal(story.video_data.call_to_action.value.link, p.link);
  assert.equal(story.video_data.link, undefined);
  assert.equal(story.video_data.link_description, "Description");
  assert.equal(story.video_data.image_hash, undefined);
  assert.equal(JSON.stringify(original), snapshot);
});
test("Creative conversion removes fields that belong only to the other media shape", () => {
  const videoModel = describeModel({ id: "1", object_story_spec: { page_id: "123", video_data: { video_id: "old", title: "Old", link_description: "Old description", call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com" } } } } });
  const image = modelStory({ page: "123", mediaType: "image", message: "", title: "New", description: "New description", link: "https://example.com", cta: "LEARN_MORE" }, { model: videoModel, imageHash: "hash" });
  assert.equal(image.link_data.name, "New");
  assert.equal(image.link_data.description, "New description");
  assert.equal(image.link_data.title, undefined);
  assert.equal(image.link_data.link_description, undefined);

  const imageModel = describeModel({ id: "2", object_story_spec: { page_id: "123", link_data: { image_hash: "old", name: "Old", description: "Old description", link: "https://example.com", call_to_action: { type: "LEARN_MORE", value: { link: "https://example.com" } } } } });
  const video = modelStory({ page: "123", mediaType: "video", message: "", title: "New", description: "New description", link: "https://example.com", cta: "LEARN_MORE" }, { model: imageModel, videoId: "video", thumbnail: "https://example.com/thumb.jpg" });
  assert.equal(video.video_data.title, "New");
  assert.equal(video.video_data.link_description, "New description");
  assert.equal(video.video_data.name, undefined);
  assert.equal(video.video_data.description, undefined);
  assert.equal(video.video_data.link, undefined);
});
test("Dynamic creatives, carousels and published posts are not treated as reusable basic models", () => {
  assert.equal(
    describeModel({
      id: "1",
      asset_feed_spec: {},
      object_story_spec: { link_data: {} },
    }).supported,
    false,
  );
  assert.equal(
    describeModel({
      id: "1",
      object_story_spec: { link_data: { child_attachments: [{}] } },
    }).supported,
    false,
  );
  const post = describeModel({
    id: "1",
    body: "Published post",
    effective_object_story_id: "123_456",
  });
  assert.equal(post.supported, false);
  assert.equal(post.copy.message, "Published post");
  assert.equal(post.page, "123");
});
test("A messaging creative recovers a missing promoted object only from verified identity data", () => {
  const creative = {
    page: "123",
    copy: { link: "https://wa.me/5491112345678" },
  };
  assert.deepEqual(promotedObjectFromCreative("WHATSAPP", creative), {
    page_id: "123",
    whatsapp_phone_number: "5491112345678",
  });
  assert.deepEqual(promotedObjectFromCreative("INSTAGRAM_DIRECT", creative), {
    page_id: "123",
  });
  assert.throws(() =>
    promotedObjectFromCreative("WHATSAPP", {
      page: "123",
      copy: { link: "https://example.com" },
    }),
  );
  assert.throws(() => promotedObjectFromCreative("MESSENGER", { page: "" }));
});
test("WhatsApp templates accept Meta links and embedded phone configuration", () => {
  assert.equal(whatsappPhoneFromLink("https://wa.me/5491112345678"), "5491112345678");
  assert.equal(whatsappPhoneFromLink("https://api.whatsapp.com/send?phone=5491112345678&text=hola"), "5491112345678");
  assert.equal(whatsappPhoneFromCreative({ story: { link_data: { post_click_configuration: { whatsapp_business_number: "+54 9 11 1234-5678" } } } }), "5491112345678");
  assert.deepEqual(promotedObjectFromCreative("WHATSAPP", { page: "123", story: { link_data: { post_click_configuration: { whatsapp_business_number: "5491112345678" } } } }), { page_id: "123", whatsapp_phone_number: "5491112345678" });
});
test("Base ads classify the five product flows without confusing them with Meta destination types", () => {
  assert.equal(campaignKind("WHATSAPP"), "WHATSAPP");
  assert.equal(campaignKind("INSTAGRAM_DIRECT"), "INSTAGRAM_DIRECT");
  assert.equal(campaignKind("MESSENGER"), "MESSENGER");
  assert.equal(campaignKind("ON_AD"), "LEAD_FORM");
  assert.equal(campaignKind("UNDEFINED", { story: { link_data: { call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: "987" } } } } }), "LEAD_FORM");
  assert.equal(campaignKind("UNDEFINED", { copy: { cta: "WHATSAPP_MESSAGE" } }), "WHATSAPP");
  assert.equal(campaignKind("WEBSITE"), "WEBSITE");
  assert.equal(campaignKind("MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP"), "MESSAGING_MULTI");
  assert.equal(campaignKind("APP"), "UNSUPPORTED");
  assert.equal(campaignKindLabel("LEAD_FORM"), "Formulario instantáneo");
});
test("Lead-form CTAs and future inherited Meta CTAs pass safe validation", () => {
  assert.equal(CTAS.includes("SEE_DETAILS"), true);
  assert.equal(isMetaCta("SEE_DETAILS"), true);
  assert.equal(isMetaCta("A_FUTURE_META_CTA"), true);
  assert.equal(isMetaCta("see-details"), false);
  assert.equal(isMetaCta(""), false);
});
test("HTTPS is enforced only for destinations that leave Meta", () => {
  assert.doesNotThrow(() => validateDestinationLink("LEAD_FORM", "http://legacy.example/form"));
  assert.doesNotThrow(() => validateDestinationLink("MESSENGER", ""));
  assert.doesNotThrow(() => validateDestinationLink("WEBSITE", "https://example.com"));
  assert.throws(() => validateDestinationLink("WEBSITE", ""), /no informa el enlace/);
  assert.throws(() => validateDestinationLink("WEBSITE", "http://example.com"), /HTTPS/);
  assert.throws(() => validateDestinationLink("WHATSAPP", "http://wa.me/5491112345678"), /HTTPS/);
});
test("Lead forms and message templates survive a media replacement", () => {
  const source = {
    id: "1",
    object_story_spec: {
      page_id: "123",
      link_data: {
        image_hash: "old",
        message: "Old",
        link: "https://example.com",
        page_welcome_message: "Hola",
        call_to_action: {
          type: "SIGN_UP",
          value: { link: "https://example.com", lead_gen_form_id: "987" },
        },
      },
    },
  };
  const model = describeModel(source);
  assert.equal(model.kind, "LEAD_FORM");
  const story = modelStory(
    {
      page: "123",
      message: "New",
      title: "Title",
      description: "Description",
      link: "https://example.com",
      cta: "SIGN_UP",
      mediaType: "image",
    },
    { model, imageHash: "new" },
  );
  assert.equal(story.link_data.image_hash, "new");
  assert.equal(story.link_data.call_to_action.value.lead_gen_form_id, "987");
  assert.equal(story.link_data.page_welcome_message, "Hola");
});
import { jobErrorAction } from "../lib/job-errors";
test("Job failures explain what was already created and the safe next action", () => {
  assert.match(jobErrorAction("creative"), /archivo ya está en Meta/);
  assert.match(jobErrorAction("ad"), /creativo ya existe/);
  assert.match(jobErrorAction("ad", true), /verificá el ID/);
});
import { isAttributionFailure, buildRecovery, canAutoRecover } from "../lib/attribution-recovery";
import { explainLeadTermsError, leadFormId, validateLeadSetup } from "../lib/lead-form";
test("Lead-form preflight identifies the exact Page and explains Meta terms mismatches", () => {
  const model = describeModel({
    id: "1",
    object_story_spec: {
      page_id: "123",
      link_data: {
        call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: "987" } },
      },
    },
  });
  assert.equal(leadFormId(model), "987");
  assert.throws(
    () => validateLeadSetup({ pageId: "123", pageName: "Página A", termsAccepted: false }),
    /Página A.*token conectado/,
  );
  assert.throws(
    () => validateLeadSetup({ pageId: "123", formId: "987", formPageId: "456" }),
    /pertenece a la Página 456/,
  );
  const explained = explainLeadTermsError(
    new MetaError("Terms of Service Not Accepted: You can't run lead ads", 100, "trace"),
    { pageId: "123", pageName: "Página A", formId: "987", termsAccepted: true },
  );
  assert.match(explained.message, /API sí devuelve los términos como aceptados/);
  assert.match(explained.message, /ID 123/);
  assert.equal(explained.trace, "trace");
});
import { canRetryLeadTerms } from "../lib/media-retry";
import { targetSetId } from "../lib/upload-plan";
test("Upload plans support single, automatic and manual ad-set distribution", () => {
  const base = { placement: "ads" as const, baseAdset: "10", selectedAdsets: ["10", "20"] };
  assert.equal(targetSetId({ ...base, distribution: "single", index: 1 }), "10");
  assert.equal(targetSetId({ ...base, distribution: "round-robin", index: 0 }), "10");
  assert.equal(targetSetId({ ...base, distribution: "round-robin", index: 3 }), "20");
  assert.equal(targetSetId({ ...base, distribution: "manual", manualAdset: "30", index: 0 }), "30");
  assert.equal(targetSetId({ ...base, distribution: "manual", index: 0 }), "");
  assert.equal(targetSetId({ ...base, placement: "campaign", distribution: "round-robin", index: 1 }), "10");
});
test("A rejected lead-terms creative resumes without uploading its media again", () => {
  const job = {
    kind: "ad",
    status: "failed",
    state: {
      stage: "creative",
      campaignKind: "LEAD_FORM",
      imageHash: "hash",
      error: "No puedes publicar anuncios para clientes potenciales hasta que tu página acepte las condiciones.",
    },
  };
  assert.equal(canRetryLeadTerms(job), true);
  assert.equal(canRetryLeadTerms({ ...job, state: { ...job.state, creativeId: "123" } }), false);
  assert.equal(canRetryLeadTerms({ ...job, state: { ...job.state, stage: "ad", creativeId: "123" } }), true);
  assert.equal(canRetryLeadTerms({ ...job, state: { ...job.state, stage: "ad", creativeId: "123", adId: "456" } }), false);
});
test("Attribution recovery only applies to a definite rejection while copying a set", () => {
  const job = {
    kind: "template",
    status: "failed",
    state: {
      stage: "copy_sets",
      campaignId: "456",
      error: "El intervalo de atribución admite 1 día(s).",
    },
  };
  assert.equal(isAttributionFailure(job), true);
  assert.equal(isAttributionFailure({ ...job, status: "uncertain" }), false);
  assert.equal(
    isAttributionFailure({
      ...job,
      state: { ...job.state, stage: "copy_campaign" },
    }),
    false,
  );
  assert.equal(
    isAttributionFailure({
      ...job,
      state: { ...job.state, error: "Token expired" },
    }),
    false,
  );
});
test("Recovery keeps targeting and budget, changes attribution on a paused new set only", () => {
  const source = {
    id: "1",
    name: "ADV",
    destination_type: "WHATSAPP",
    optimization_goal: "CONVERSATIONS",
    billing_event: "IMPRESSIONS",
    targeting: { geo_locations: { countries: ["AR"] } },
    promoted_object: { page_id: "123", whatsapp_phone_number: "5491112345678" },
    daily_budget: "10000",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    bid_amount: 0,
    attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }],
  };
  const old = JSON.stringify(source);
  const params = buildRecovery(source, { id: "456", status: "PAUSED" });
  assert.equal(params.campaign_id, "456");
  assert.equal(params.status, "PAUSED");
  assert.equal(params.daily_budget, "10000");
  assert.equal(params.bid_amount, undefined);
  assert.deepEqual(params.attribution_spec, [{ event_type: "CLICK_THROUGH", window_days: 1 }]);
  assert.deepEqual(params.targeting, source.targeting);
  assert.equal(JSON.stringify(source), old);
  assert.equal(
    buildRecovery(source, {
      id: "456",
      status: "PAUSED",
      daily_budget: "20000",
    }).daily_budget,
    undefined,
  );
  assert.throws(() => buildRecovery(source, { id: "456", status: "ACTIVE" }));
  assert.equal(buildRecovery(source, { id: "456", status: "ACTIVE" }, { allowActiveCampaign: true }).status, "PAUSED");
  assert.throws(() => buildRecovery(source, { id: "456", status: "ARCHIVED" }, { allowActiveCampaign: true }));
  assert.throws(() => buildRecovery({ ...source, is_dynamic_creative: true }, { id: "456", status: "PAUSED" }));
  assert.throws(() => buildRecovery({ ...source, optimization_goal: "OFFSITE_CONVERSIONS" }, { id: "456", status: "PAUSED" }));
});

test("Automatic template recovery excludes ambiguous writes, cooldowns and old jobs", () => {
  const state = {
    autoAttribution: true,
    stage: "copy_sets",
    campaignId: "456",
  };
  const message = "El intervalo de atribución admite 1 día(s).";
  assert.equal(canAutoRecover(state, new MetaError(message, 100, "trace", false)), true);
  assert.equal(canAutoRecover(state, new MetaError(message, 100, "trace", true)), false);
  assert.equal(canAutoRecover(state, new MetaError(message, 429, "trace", false, 60)), false);
  assert.equal(canAutoRecover({ ...state, autoAttribution: false }, new MetaError(message, 100, "trace", false)), false);
  assert.equal(canAutoRecover(state, new Error(message)), false);
});

import { canRetryMediaPreparation } from "../lib/media-retry";
test("Only failed preparation with the known stream error can be retried without Meta duplication", () => {
  const job = {
    kind: "ad",
    status: "failed",
    state: {
      stage: "prepare",
      error: "Provided readable stream must have a known length (request/response body or readable half of FixedLengthStream)",
    },
  };
  assert.equal(canRetryMediaPreparation(job), true);
  assert.equal(canRetryMediaPreparation({ ...job, status: "uncertain" }), false);
  assert.equal(
    canRetryMediaPreparation({
      ...job,
      state: { ...job.state, stage: "upload" },
    }),
    false,
  );
  assert.equal(canRetryMediaPreparation({ ...job, state: { ...job.state, adId: "123" } }), false);
});

import { canRetryDevelopmentAd } from "../lib/media-retry";
test("Publishing recovery resumes only a definite development-mode rejection with an existing creative", () => {
  const job = {
    kind: "ad",
    status: "failed",
    state: {
      stage: "ad",
      creativeId: "456",
      error: "La publicación se creó con una app en modo de desarrollo. Debe estar en modo público para crear este anuncio.",
    },
  };
  assert.equal(canRetryDevelopmentAd(job), true);
  assert.equal(canRetryDevelopmentAd({ ...job, status: "uncertain" }), false);
  assert.equal(canRetryDevelopmentAd({ ...job, state: { ...job.state, adId: "789" } }), false);
  assert.equal(
    canRetryDevelopmentAd({
      ...job,
      state: { ...job.state, creativeId: undefined },
    }),
    false,
  );
  assert.equal(
    canRetryDevelopmentAd({
      ...job,
      state: { ...job.state, error: "Invalid parameter" },
    }),
    false,
  );
});
import { canRetryCampaignAttribution, canRetryAdsetAttribution, canRetryCreativeShape } from "../lib/media-retry";
test("Campaign recovery resumes only a definite one-day attribution rejection inside an existing campaign", () => {
  const job = {
    kind: "campaign",
    status: "failed",
    state: {
      stage: "create_sets",
      campaignId: "456",
      createdSets: [],
      error: "El intervalo de atribución de conversiones acepta el intervalo de atribución de 1 día(s).",
    },
  };
  assert.equal(canRetryCampaignAttribution(job), true);
  assert.equal(canRetryCampaignAttribution({ ...job, status: "uncertain" }), false);
  assert.equal(
    canRetryCampaignAttribution({
      ...job,
      state: { ...job.state, stage: "create_campaign" },
    }),
    false,
  );
  assert.equal(
    canRetryCampaignAttribution({
      ...job,
      state: { ...job.state, campaignId: undefined },
    }),
    false,
  );
  assert.equal(
    canRetryCampaignAttribution({
      ...job,
      state: { ...job.state, error: "Invalid targeting" },
    }),
    false,
  );
});
test("Ad set copy can resume after the former active-campaign recovery guard", () => {
  const job = { kind: "adset-copy", status: "failed", state: { stage: "copy_adset", error: "La campaña de destino debe estar pausada para recuperar la copia." } };
  assert.equal(canRetryAdsetAttribution(job), true);
  assert.equal(canRetryAdsetAttribution({ ...job, status: "uncertain" }), false);
  assert.equal(canRetryAdsetAttribution({ ...job, state: { ...job.state, adsetId: "123" } }), false);
});
test("A rejected creative with an invalid inherited media field can resume safely", () => {
  const job = { kind: "ad", status: "failed", state: { stage: "creative", videoId: "123", error: "El campo link no se admite en el campo video_data de object_story_spec." } };
  assert.equal(canRetryCreativeShape(job), true);
  assert.equal(canRetryCreativeShape({ ...job, state: { stage: "creative", imageHash: "hash", error: "El campo title no se admite en el campo link_data de object_story_spec." } }), true);
  assert.equal(canRetryCreativeShape({ ...job, state: { ...job.state, creativeId: "456" } }), false);
  assert.equal(canRetryCreativeShape({ ...job, status: "uncertain" }), false);
});

import { tokenMetadata, tokenDeadline, tokenLabel, exchangeToken } from "../lib/token-core";
import { assertDraftParent } from "../lib/draft-parent";
import { filterAccounts } from "../lib/account-selection";
test("Expiry uses real Meta timestamps, includes data access deadline and distinguishes invalid or unknown tokens", () => {
  const now = 100000;
  const data = {
    app_id: "123",
    type: "USER",
    is_valid: true,
    expires_at: 1000,
    data_access_expires_at: 500,
  };
  const m = tokenMetadata(data, "123", now);
  assert.equal(tokenDeadline(m), 500000);
  assert.match(tokenLabel(m, now), /min/);
  assert.match(tokenLabel(m, 600000), /vencido/);
  assert.match(tokenLabel({ ...m, isValid: false }, now), /inválido/);
  assert.equal(tokenDeadline(tokenMetadata({ ...data, expires_at: 0, data_access_expires_at: 0 }, "123")), null);
  assert.match(tokenLabel(null), /sin consultar/);
  assert.throws(() => tokenMetadata(data, "456"));
});
test("Work account selection distinguishes all accounts from an empty list and does not alter available accounts", () => {
  const a = [{ id: "act_1" }, { id: "act_2" }];
  assert.deepEqual(filterAccounts(a, null), a);
  assert.deepEqual(filterAccounts(a, []), []);
  assert.deepEqual(filterAccounts(a, ["act_2", "act_3"]), [{ id: "act_2" }]);
  assert.equal(a.length, 2);
});
test("Active and paused parents accept new paused children", () => {
  assert.doesNotThrow(() => assertDraftParent("campaign", "ACTIVE"));
  assert.doesNotThrow(() => assertDraftParent("campaign", "PAUSED"));
  assert.doesNotThrow(() => assertDraftParent("adset", "ACTIVE"));
  assert.doesNotThrow(() => assertDraftParent("adset", "PAUSED"));
  assert.throws(() => assertDraftParent("campaign", "ARCHIVED"), /campaña de destino/);
  assert.throws(() => assertDraftParent("adset", "DELETED"), /conjunto de destino/);
});
test("Token exchange validates both tokens and returns only Meta expiry without inventing 60 days", async () => {
  const original = globalThis.fetch,
    old = "oldtoken01234567890123456789",
    next = "newtoken01234567890123456789";
  const calls: any[] = [];
  try {
    globalThis.fetch = async (url: any) => {
      const u = new URL(url);
      calls.push(u);
      if (u.pathname.endsWith("debug_token"))
        return Response.json({
          data: {
            app_id: "123",
            type: "USER",
            is_valid: true,
            expires_at: u.searchParams.get("input_token") === next ? 9000 : 1000,
            data_access_expires_at: 10000,
          },
        });
      assert.equal(u.searchParams.get("grant_type"), "fb_exchange_token");
      assert.equal(u.searchParams.get("fb_exchange_token"), old);
      assert.equal(u.searchParams.get("client_secret"), "private-secret");
      return Response.json({ access_token: next });
    };
    const r = await exchangeToken(old, "123", "private-secret");
    assert.equal(r.token, next);
    assert.equal(r.metadata.expiresAt, 9000000);
    assert.equal(calls.length, 3);
    globalThis.fetch = async () => Response.json({ error: { code: 190, message: old + " private-secret" } });
    await assert.rejects(exchangeToken(old, "123", "private-secret"), (e) => !String(e).includes(old) && !String(e).includes("private-secret"));
  } finally {
    globalThis.fetch = original;
  }
});

import { dispositionFilename, defaultAdName, driveFileId, fallbackFilename, isDriveAccessPage, looksLikeLocalFilePath } from "../lib/file-name";
test("Local filesystem paths are not treated as Drive links", () => {
  assert.equal(looksLikeLocalFilePath("/tmp/herdr-clipboard-images-1000/client-424-clipboard-1791857999443083440-0.png"), true);
  assert.equal(looksLikeLocalFilePath("https://drive.google.com/file/d/abcdefghijkl/view"), false);
  assert.equal(looksLikeLocalFilePath(""), false);
});
test("File names omit media extensions and decode Drive download names", () => {
  assert.equal(supportedFile({ name: "Video Oferta 01.mp4", type: "video/mp4", size: 10 }).name, "Video Oferta 01");
  assert.equal(dispositionFilename('attachment; filename="Oferta 01.png"'), "Oferta 01.png");
  assert.equal(dispositionFilename("attachment; filename*=UTF-8''Oferta%20oto%C3%B1o.mp4"), "Oferta otoño.mp4");
  assert.equal(dispositionFilename("text/html"), "");
  assert.equal(defaultAdName("x".repeat(250)).length, 200);
});
test("Drive filename fallback uses a stable id and MIME extension only for supported media", () => {
  assert.equal(driveFileId("https://drive.google.com/file/d/abcdefghijkl/view?usp=sharing"), "abcdefghijkl");
  assert.equal(driveFileId("https://drive.google.com/uc?export=download&id=abcdefghijkl"), "abcdefghijkl");
  assert.equal(driveFileId("not a url"), "");
  assert.equal(fallbackFilename("abcdefghijkl", "image/png"), "drive-abcdefghijkl.png");
  assert.equal(fallbackFilename("abcdefghijkl", "image/jpeg"), "drive-abcdefghijkl.jpg");
  assert.equal(fallbackFilename("abcdefghijkl", "video/mp4; codecs=avc1"), "drive-abcdefghijkl.mp4");
  assert.equal(fallbackFilename("abcdefghijkl", "video/quicktime"), "drive-abcdefghijkl.mov");
  assert.equal(fallbackFilename("abcdefghijkl", "text/html"), "");
  assert.equal(fallbackFilename("abcdefghijkl", "application/octet-stream"), "");
  assert.equal(fallbackFilename("", "image/png"), "");
  assert.equal(fallbackFilename("../../etc/passwd", "image/png"), "drive-etcpasswd.png");
});
test("Drive access and confirmation pages are distinguished from missing metadata", () => {
  assert.equal(isDriveAccessPage("text/html; charset=utf-8"), true);
  assert.equal(isDriveAccessPage("text/plain"), true);
  assert.equal(isDriveAccessPage("image/png"), false);
  assert.equal(isDriveAccessPage("application/pdf"), false);
});

import { selectTemplateSets } from "../lib/template-selection";
test("Template copy selects only requested sets, checks campaign membership and supports large source campaigns", () => {
  const available = Array.from({ length: 30 }, (_, i) => ({
    id: String(i + 1),
    name: "Set " + i,
  }));
  const result = selectTemplateSets(available, ["3", "1", "3"]);
  assert.deepEqual(result.ids, ["1", "3"]);
  assert.deepEqual(
    result.sets.map((s) => s.id),
    ["1", "3"],
  );
  assert.throws(() => selectTemplateSets(available, []));
  assert.throws(() => selectTemplateSets(available, ["99"]));
  assert.throws(() => selectTemplateSets(available));
  assert.equal(selectTemplateSets(available.slice(0, 2)).sets.length, 2);
  assert.equal(available.length, 30);
});

import { groupKey, buildGroups, validateSets, buildCampaignParams, buildAdSetParams } from "../lib/campaign-build";
test("Structure grouping normalizes variation suffixes without merging distinct hooks", () => {
  assert.equal(groupKey("hook1.mp4"), "hook1");
  assert.equal(groupKey("hook1_vertical.mp4"), "hook1");
  assert.equal(groupKey("hook1 9x16.png"), "hook1");
  assert.equal(groupKey("Oferta 01.MOV"), "Oferta 01");
  assert.notEqual(groupKey("hook1.mp4"), groupKey("hook2.mp4"));
});
test("Grouping modes build single, per-creative, auto-group and custom sets with limits", () => {
  const rows = [
    { key: "a", name: "hook1.mp4", group: "" },
    { key: "b", name: "hook1_vertical.mp4", group: "" },
    { key: "c", name: "hook2.mp4", group: "" },
  ];
  assert.deepEqual(
    buildGroups(rows, "single", "Base").map((g) => g.name),
    ["Base"],
  );
  assert.equal(buildGroups(rows, "per-creative", "").length, 3);
  const auto = buildGroups(rows, "auto-group", "");
  assert.equal(auto.length, 2);
  assert.deepEqual(auto[0].rowKeys, ["a", "b"]);
  assert.throws(() => buildGroups(rows, "custom", ""));
  const custom = buildGroups(
    rows.map((r, i) => ({ ...r, group: i < 2 ? "A" : "B" })),
    "custom",
    "",
  );
  assert.deepEqual(
    custom.map((g) => [g.name, g.rowKeys.length]),
    [
      ["A", 2],
      ["B", 1],
    ],
  );
  assert.throws(() =>
    validateSets([
      { key: "1", name: "Same" },
      { key: "2", name: "Same" },
    ]),
  );
  assert.throws(() => validateSets(Array.from({ length: 21 }, (_, i) => ({ key: String(i), name: "S" + i }))));
});
test("Campaign params inherit the model objective and only carry budget and bid when optimized by campaign", () => {
  const model = {
    objective: "OUTCOME_TRAFFIC",
    special_ad_categories: ["NONE"],
  };
  const cbo = buildCampaignParams(
    {
      name: "Oct",
      objective: "OUTCOME_SALES",
      cbo: true,
      budgetType: "daily",
      budgetAmount: 5000,
      bidStrategy: "LOWEST_COST_WITH_BID_CAP",
      bidAmount: 300,
    },
    model,
  );
  assert.equal(cbo.objective, "OUTCOME_TRAFFIC");
  assert.equal(cbo.daily_budget, 5000);
  assert.equal(cbo.bid_amount, 300);
  assert.deepEqual(cbo.special_ad_categories, ["NONE"]);
  const abo = buildCampaignParams(
    {
      name: "Oct",
      cbo: false,
      budgetType: "daily",
      budgetAmount: 5000,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    },
    model,
  );
  assert.equal(abo.objective, "OUTCOME_TRAFFIC");
  assert.equal(abo.daily_budget, undefined);
  assert.equal(abo.bid_strategy, undefined);
  assert.throws(() => buildCampaignParams({ name: "Oct" }, { special_ad_categories: [] }));
  assert.throws(() =>
    buildCampaignParams(
      {
        name: "Oct",
        cbo: true,
        budgetAmount: 0,
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      },
      model,
    ),
  );
});
test("Lifetime budgets require a valid schedule and are written with start and end dates", () => {
  const model = { objective: "OUTCOME_TRAFFIC", special_ad_categories: [] };
  const start = "2026-11-01T10:00:00.000Z",
    end = "2026-11-08T10:00:00.000Z";
  const cbo = buildCampaignParams(
    {
      name: "Oct",
      cbo: true,
      budgetType: "lifetime",
      budgetAmount: 50000,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      startTime: start,
      endTime: end,
    },
    model,
  );
  assert.equal(cbo.lifetime_budget, 50000);
  assert.equal(cbo.start_time, start);
  assert.equal(cbo.end_time, end);
  assert.throws(() =>
    buildCampaignParams(
      {
        name: "Oct",
        cbo: true,
        budgetType: "lifetime",
        budgetAmount: 50000,
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      },
      model,
    ),
  );
  assert.throws(() =>
    buildCampaignParams(
      {
        name: "Oct",
        cbo: true,
        budgetType: "lifetime",
        budgetAmount: 50000,
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        startTime: end,
        endTime: start,
      },
      model,
    ),
  );
  const adsetModel = {
    destination_type: "WEBSITE",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    targeting: { geo_locations: { countries: ["AR"] } },
  };
  const adset = buildAdSetParams(
    {
      cbo: false,
      adBudgetType: "lifetime",
      adBudgetAmount: 20000,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      startTime: start,
      endTime: end,
    },
    adsetModel,
    "456",
    "Conjunto A",
  );
  assert.equal(adset.lifetime_budget, 20000);
  assert.equal(adset.start_time, start);
  assert.equal(adset.end_time, end);
  assert.throws(() =>
    buildAdSetParams(
      {
        cbo: false,
        adBudgetType: "lifetime",
        adBudgetAmount: 20000,
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      },
      adsetModel,
      "456",
      "X",
    ),
  );
});
test("Ad set params clone the model, apply overrides and normalize message attribution on a paused set", () => {
  const model = {
    destination_type: "WHATSAPP",
    optimization_goal: "CONVERSATIONS",
    billing_event: "IMPRESSIONS",
    targeting: {
      geo_locations: { countries: ["AR"] },
      age_min: 18,
      age_max: 65,
    },
    promoted_object: { page_id: "123", whatsapp_phone_number: "5491112345678" },
    attribution_spec: [{ event_type: "CLICK_THROUGH", window_days: 7 }],
  };
  const snapshot = JSON.stringify(model);
  const input = {
    cbo: false,
    targeting: {
      countries: ["MX", "AR"],
      ageMin: 21,
      ageMax: 45,
      genders: [1, 2],
    },
    adBudgetType: "daily",
    adBudgetAmount: 10000,
    bidStrategy: "COST_CAP",
    bidAmount: 250,
  };
  const params = buildAdSetParams(input, model, "456", "Conjunto A");
  assert.equal(params.campaign_id, "456");
  assert.equal(params.status, "PAUSED");
  assert.deepEqual(params.targeting.geo_locations.countries, ["MX", "AR"]);
  assert.equal(params.targeting.age_min, 21);
  assert.deepEqual(params.targeting.genders, [1, 2]);
  assert.equal(params.daily_budget, 10000);
  assert.equal(params.bid_amount, 250);
  assert.deepEqual(params.attribution_spec, [{ event_type: "CLICK_THROUGH", window_days: 1 }]);
  assert.deepEqual(params.promoted_object, model.promoted_object);
  assert.equal(JSON.stringify(model), snapshot);
  const cbo = buildAdSetParams({ ...input, cbo: true }, model, "456", "Conjunto A");
  assert.equal(cbo.daily_budget, undefined);
  assert.equal(cbo.bid_strategy, undefined);
  assert.throws(() => buildAdSetParams(input, { destination_type: "CONVERSATIONS" }, "456", "X"));
  assert.throws(() => buildAdSetParams(input, { ...model, promoted_object: undefined }, "456", "X"));
  assert.throws(() => buildAdSetParams({ cbo: false, targeting: { countries: [] } }, model, "456", "X"));
  assert.deepEqual(
    buildAdSetParams(
      {
        cbo: false,
        targeting: { countries: [] },
        adBudgetType: "daily",
        adBudgetAmount: 1000,
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      },
      { ...model, attribution_spec: undefined },
      "456",
      "X",
    ).attribution_spec,
    [{ event_type: "CLICK_THROUGH", window_days: 1 }],
  );
});
import { recoverySource } from "../lib/recovery-source";
test("Missing message promoted object is recovered only from a single verified creative page", async () => {
  const source = { id: "1", destination_type: "INSTAGRAM_DIRECT" };
  let reads = 0;
  const call = async (path: string) => {
    reads++;
    return path === "1"
      ? { ...source }
      : {
          data: [{ object_story_spec: { page_id: "123" } }, { effective_object_story_id: "123_456" }],
        };
  };
  const r = await recoverySource(call, "1");
  assert.deepEqual(r.promoted_object, { page_id: "123" });
  assert.equal(r.recovery_page_source, "existing_creatives");
  assert.equal(reads, 2);
  assert.equal((source as any).promoted_object, undefined);
  await assert.rejects(recoverySource(async (path) => (path === "1" ? source : { data: [{ effective_object_story_id: "456" }] }), "1"));
  await assert.rejects(
    recoverySource(
      async (path) =>
        path === "1"
          ? source
          : {
              data: [{ object_story_spec: { page_id: "123" } }, { object_story_spec: { page_id: "789" } }],
            },
      "1",
    ),
  );
});
test("Missing WhatsApp promoted object is recovered from one verified page and phone", async () => {
  const source = { id: "1", destination_type: "WHATSAPP" };
  const creative = {
    object_story_spec: {
      page_id: "123",
      link_data: {
        link: "https://wa.me/5491112345678",
        call_to_action: {
          type: "WHATSAPP_MESSAGE",
          value: { link: "https://wa.me/5491112345678" },
        },
      },
    },
  };
  const recovered = await recoverySource(async (path) => (path === "1" ? { ...source } : { data: [creative] }), "1");
  assert.deepEqual(recovered.promoted_object, {
    page_id: "123",
    whatsapp_phone_number: "5491112345678",
  });
  await assert.rejects(
    recoverySource(
      async (path) =>
        path === "1"
          ? { ...source }
          : {
              data: [
                creative,
                {
                  object_story_spec: {
                    page_id: "123",
                    link_data: { link: "https://wa.me/5491187654321" },
                  },
                },
              ],
            },
      "1",
    ),
  );
});
test("Preparation failure remains recoverable without allowing retries of ambiguous write outcomes", () => {
  const state = {
    stage: "copy_sets",
    campaignId: "2",
    autoAttribution: true,
    copiedSets: [],
    error: "Meta no devolvió la configuración necesaria para recuperar el conjunto.",
  };
  assert.equal(isAttributionFailure({ kind: "template", status: "uncertain", state }), true);
  assert.equal(
    isAttributionFailure({
      kind: "template",
      status: "uncertain",
      state: { ...state, error: "La conexión se interrumpió" },
    }),
    false,
  );
  assert.equal(
    isAttributionFailure({
      kind: "template",
      status: "uncertain",
      state: { ...state, attributionRecovery: {} },
    }),
    false,
  );
  assert.equal(
    isAttributionFailure({
      kind: "template",
      status: "failed",
      state: { ...state, attributionRejected: { sourceId: "1" } },
    }),
    true,
  );
  assert.throws(
    () =>
      buildRecovery(
        {
          destination_type: "INSTAGRAM_DIRECT",
          optimization_goal: "CONVERSATIONS",
        },
        { id: "2", status: "PAUSED" },
      ),
    /targeting, promoted_object, billing_event/,
  );
});

test('run plans only name the structure they create', async () => {
  const { plannedStructureNames } = await import('../lib/upload-plan');
  const names = { campaignName: 'Primavera · copia', adsetName: 'Amplio · copia' };
  assert.deepEqual(plannedStructureNames('ads', names), {});
  assert.deepEqual(plannedStructureNames('adset', names), { adsetName: 'Amplio · copia' });
  assert.deepEqual(plannedStructureNames('campaign', names), names);
});
