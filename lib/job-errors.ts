export function jobErrorAction(stage = "", ambiguous = false) {
  if (ambiguous)
    return "Meta pudo haber creado este objeto. Abrí Ads Manager y verificá el ID antes de reintentar.";
  if (["prepare", "upload"].includes(stage))
    return "El anuncio todavía no se creó. Corregí el archivo o el enlace y retomá este trabajo.";
  if (stage === "video")
    return "Meta no terminó de procesar el video. Podés retomar este trabajo sin volver a subirlo.";
  if (stage === "creative")
    return "El archivo ya está en Meta. Revisá el anuncio base y retomá para crear el creativo.";
  if (stage === "ad")
    return "El creativo ya existe. Revisá el conjunto y retomá para crear solamente el anuncio.";
  if (["copy_sets", "create_sets"].includes(stage))
    return "La campaña ya existe. Revisá los conjuntos creados y retomá desde este paso.";
  return "Revisá la configuración indicada y retomá el trabajo desde el historial.";
}
