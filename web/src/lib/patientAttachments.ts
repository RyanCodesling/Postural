const ATTACHMENT_FORMATS = {
  "image/jpeg": { extensions: ["jpg", "jpeg"], aliases: ["image/jpeg"] },
  "image/png": { extensions: ["png"], aliases: ["image/png"] },
  "image/webp": { extensions: ["webp"], aliases: ["image/webp"] },
  "application/pdf": { extensions: ["pdf"], aliases: ["application/pdf"] },
  "application/msword": { extensions: ["doc"], aliases: ["application/msword"] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extensions: ["docx"],
    aliases: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  "application/vnd.ms-excel": { extensions: ["xls"], aliases: ["application/vnd.ms-excel"] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extensions: ["xlsx"],
    aliases: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  "application/vnd.ms-powerpoint": { extensions: ["ppt"], aliases: ["application/vnd.ms-powerpoint"] },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    extensions: ["pptx"],
    aliases: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  "application/rtf": { extensions: ["rtf"], aliases: ["application/rtf", "text/rtf"] },
  "text/plain": { extensions: ["txt"], aliases: ["text/plain"] },
} as const;

export type PatientAttachmentMimeType = keyof typeof ATTACHMENT_FORMATS;

export const PATIENT_ATTACHMENT_ACCEPT = Object.entries(ATTACHMENT_FORMATS)
  .flatMap(([mimeType, format]) => [mimeType, ...format.extensions.map((extension) => `.${extension}`)])
  .join(",");

export function patientAttachmentMimeType(
  file: { name: string; type: string },
): PatientAttachmentMimeType | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  const declaredType = file.type.toLowerCase();
  const match = Object.entries(ATTACHMENT_FORMATS).find(([, format]) =>
    format.extensions.includes(extension as never) &&
    (declaredType === "" || declaredType === "application/octet-stream" || format.aliases.includes(declaredType as never)),
  );
  return (match?.[0] as PatientAttachmentMimeType | undefined) ?? null;
}

export function isPatientImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}