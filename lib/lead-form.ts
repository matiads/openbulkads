import { MetaError } from "./meta-core";

export function leadFormId(creative: any) {
  const story = creative?.story || creative?.object_story_spec || {};
  const data = story.link_data || story.video_data || story.template_data || {};
  const value = data.call_to_action?.value || {};
  return String(value.lead_gen_form_id || value.leadgen_form_id || "");
}

export type LeadSetup = {
  pageId: string;
  pageName?: string;
  termsAccepted?: boolean;
  termsAcceptedAt?: string;
  formId?: string;
  formName?: string;
  formPageId?: string;
};

export async function inspectLeadSetup(
  call: (path: string, params?: Record<string, any>, method?: string) => Promise<any>,
  pageId: string,
  formId: string,
) {
  const setup: LeadSetup = { pageId, ...(formId ? { formId } : {}) };
  try {
    const page = await call(pageId, {
      fields: "id,name,leadgen_tos_accepted,leadgen_tos_acceptance_time",
    });
    setup.pageName = page.name;
    if (typeof page.leadgen_tos_accepted === "boolean")
      setup.termsAccepted = page.leadgen_tos_accepted;
    if (page.leadgen_tos_acceptance_time)
      setup.termsAcceptedAt = page.leadgen_tos_acceptance_time;
  } catch {
    // Some valid ads tokens cannot read Page-only fields. Meta will still validate
    // the terms when the creative is created, so an inconclusive check must not block it.
  }
  if (formId) {
    try {
      const form = await call(formId, { fields: "id,name,page_id,status" });
      setup.formName = form.name;
      setup.formPageId = String(form.page_id || form.page?.id || "");
    } catch {
      // The creative itself remains the source of truth if form details are unavailable.
    }
  }
  return setup;
}

export function validateLeadSetup(setup: LeadSetup) {
  const page = `${setup.pageName ? `“${setup.pageName}” ` : ""}(ID ${setup.pageId})`;
  if (setup.formPageId && setup.formPageId !== setup.pageId)
    throw new Error(
      `El formulario ${setup.formName ? `“${setup.formName}” ` : ""}(ID ${setup.formId}) pertenece a la Página ${setup.formPageId}, pero el anuncio usa la Página ${setup.pageId}. Elegí un anuncio base y un conjunto de la misma Página.`,
    );
  if (setup.termsAccepted === false)
    throw new Error(
      `Meta informa que la Página ${page} no aceptó las Condiciones de clientes potenciales para el token conectado. Aceptalas con un administrador de esa Página y volvé a conectar Meta.`,
    );
}

export function explainLeadTermsError(error: unknown, setup: LeadSetup) {
  const source = error as MetaError;
  if (!/clientes potenciales|lead (?:generation )?(?:ads )?terms|terms of service not accepted/i.test(source.message || ""))
    return source;
  const page = `${setup.pageName ? `“${setup.pageName}” ` : ""}(ID ${setup.pageId})`;
  const apiState = setup.termsAccepted === true
    ? "La API sí devuelve los términos como aceptados"
    : setup.termsAccepted === false
      ? "La API devuelve los términos como no aceptados"
      : "El token conectado no permitió comprobar la aceptación";
  const metaDetail = [source.message, source.code ? `código ${source.code}` : ""]
    .filter(Boolean)
    .join(" · ");
  return new MetaError(
    `Meta rechazó el anuncio para clientes potenciales de la Página ${page}. ${apiState}. Verificá que el formulario${setup.formId ? ` (ID ${setup.formId})` : ""} pertenezca a esa misma Página; después aceptá nuevamente las Condiciones con un administrador de la Página y reconectá Meta para renovar el token.${metaDetail ? ` Detalle de Meta: ${metaDetail}.` : ""}`,
    source.code,
    source.trace,
    source.ambiguous,
    source.wait,
  );
}
