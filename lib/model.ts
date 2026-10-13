export const CREATIVE_FIELDS =
  "id,account_id,name,object_story_spec,object_story_id,effective_object_story_id,instagram_user_id,source_instagram_media_id,asset_feed_spec,body,title,link_url,call_to_action_type,url_tags";

export const CTAS = [
  "LEARN_MORE",
  "SHOP_NOW",
  "CONTACT_US",
  "WHATSAPP_MESSAGE",
  "INSTAGRAM_MESSAGE",
  "MESSAGE_PAGE",
  "SEND_MESSAGE",
  "SIGN_UP",
  "GET_QUOTE",
  "APPLY_NOW",
  "SUBSCRIBE",
  "DOWNLOAD",
  "SEE_DETAILS",
] as const;

export function isMetaCta(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value);
}

export function validateDestinationLink(kind: string, value: string) {
  if (kind === "WEBSITE" && !value) throw new Error("El anuncio base no informa el enlace de destino.");
  if (!value || !["WEBSITE", "WHATSAPP"].includes(kind)) return;
  let link: URL;
  try {
    link = new URL(value);
  } catch {
    throw new Error("El destino debe usar un enlace válido.");
  }
  if (link.protocol !== "https:") throw new Error("El destino debe usar HTTPS.");
}

const dataBlock = (story: any) =>
  story?.link_data || story?.video_data || story?.template_data || null;

export function whatsappPhoneFromLink(value: string) {
  try {
    const link = new URL(value);
    if (link.protocol !== "https:") return "";
    const raw = link.hostname === "wa.me" ? link.pathname.slice(1) : link.searchParams.get("phone") || "";
    return raw.replace(/\D/g, "");
  } catch {
    return "";
  }
}

export function whatsappPhoneFromCreative(creative: any) {
  const data = creative?.story ? dataBlock(creative.story) : dataBlock(creative?.object_story_spec);
  const configured = data?.post_click_configuration?.whatsapp_business_number || data?.call_to_action?.value?.whatsapp_business_number;
  return String(configured || "").replace(/\D/g, "") || whatsappPhoneFromLink(creative?.copy?.link || data?.link || data?.call_to_action?.value?.link || "");
}

export function campaignKind(destination: string, creative?: any) {
  if (destination === "UNDEFINED") destination = "";
  const data = creative?.story
    ? dataBlock(creative.story)
    : dataBlock(creative?.object_story_spec);
  const cta = data?.call_to_action?.type || creative?.copy?.cta || "";
  const value = data?.call_to_action?.value || {};
  if (destination === "WHATSAPP") return "WHATSAPP";
  if (destination === "INSTAGRAM_DIRECT") return "INSTAGRAM_DIRECT";
  if (destination === "MESSENGER") return "MESSENGER";
  if (destination.startsWith("MESSAGING_")) return "MESSAGING_MULTI";
  if (
    destination === "ON_AD" ||
    value.lead_gen_form_id ||
    value.leadgen_form_id
  )
    return "LEAD_FORM";
  if (destination === "WEBSITE") return "WEBSITE";
  if (!destination) {
    if (cta === "WHATSAPP_MESSAGE") return "WHATSAPP";
    if (cta === "INSTAGRAM_MESSAGE") return "INSTAGRAM_DIRECT";
    if (["MESSAGE_PAGE", "SEND_MESSAGE"].includes(cta)) return "MESSENGER";
    return "WEBSITE";
  }
  return "UNSUPPORTED";
}

export function campaignKindLabel(kind: string) {
  return (
    (
      {
        WHATSAPP: "WhatsApp",
        INSTAGRAM_DIRECT: "Instagram DM",
        MESSENGER: "Facebook Messages",
        MESSAGING_MULTI: "Mensajería multicanal",
        LEAD_FORM: "Formulario instantáneo",
        WEBSITE: "Sitio web / conversiones",
        UNSUPPORTED: "Destino todavía no soportado",
      } as Record<string, string>
    )[kind] || kind
  );
}

export function describeModel(c: any) {
  const story = c.object_story_spec || {},
    data = dataBlock(story) || {};
  const cta =
    data.call_to_action?.type || c.call_to_action_type || "LEARN_MORE";
  const supported = Boolean(
    dataBlock(story) &&
      !c.asset_feed_spec &&
      !data.child_attachments &&
      !data.collection_thumbnails,
  );
  const result: any = {
    creativeId: c.id,
    name: c.name,
    supported,
    reason: supported
      ? ""
      : c.asset_feed_spec || data.child_attachments
        ? "Este anuncio usa un formato dinámico o carrusel que todavía no permite reemplazar el archivo."
        : "Meta no devolvió una estructura reutilizable para este anuncio.",
    page:
      story.page_id ||
      (/^\d+_\d+$/.test(c.effective_object_story_id || "")
        ? c.effective_object_story_id.split("_")[0]
        : "") ||
      "",
    instagram: story.instagram_user_id || c.instagram_user_id || "",
    copy: {
      message: data.message || c.body || "",
      title: data.name || data.title || c.title || "",
      description: data.description || data.link_description || "",
      link: data.link || data.call_to_action?.value?.link || c.link_url || "",
      urlTags: c.url_tags || "",
      cta,
    },
    story: supported ? story : undefined,
  };
  result.whatsappPhone = whatsappPhoneFromCreative(result);
  result.kind = campaignKind("", result);
  result.kindLabel = campaignKindLabel(result.kind);
  return result;
}

export function promotedObjectFromCreative(destination: string, creative: any) {
  if (!creative?.page || !/^\d+$/.test(creative.page))
    throw new Error("El anuncio base no informa una Página verificable.");
  const promoted: any = { page_id: creative.page };
  if (destination === "WHATSAPP") {
    const phone = whatsappPhoneFromCreative(creative);
    if (!phone)
      throw new Error(
        "El anuncio base no informa un número de WhatsApp verificable.",
      );
    promoted.whatsapp_phone_number = phone;
  }
  return promoted;
}

export function modelStory(p: any, s: any) {
  const source = s.model?.story;
  if (!source) return null;
  const sourceKey = source.link_data
    ? "link_data"
    : source.video_data
      ? "video_data"
      : source.template_data
        ? "template_data"
        : "";
  if (!sourceKey) return null;
  const story: any = structuredClone(source),
    data: any = structuredClone(source[sourceKey]);
  story.page_id = p.page;
  if (p.instagram) story.instagram_user_id = p.instagram;
  for (const key of ["image_hash", "video_id", "image_url", "image_crops"])
    delete data[key];
  data.message = p.message;
  if (data.call_to_action) {
    data.call_to_action.type = p.cta;
    if (p.link)
      data.call_to_action.value = {
        ...data.call_to_action.value,
        link: p.link,
      };
  }
  if (p.mediaType === "image") {
    delete data.title;
    delete data.link_description;
    if (p.link) data.link = p.link;
    Object.assign(data, {
      image_hash: s.imageHash,
      name: p.title,
      description: p.description || "",
    });
    delete story.video_data;
    delete story.template_data;
    story.link_data = data;
  } else {
    delete data.link;
    delete data.name;
    delete data.description;
    Object.assign(data, {
      video_id: s.videoId,
      image_url: s.thumbnail,
      title: p.title,
      link_description: p.description || "",
    });
    delete story.link_data;
    delete story.template_data;
    story.video_data = data;
  }
  return story;
}
