import { redactText } from "../cli/redact.mjs";

// What a failed Ploi request's body says went wrong: its `message`, then a
// validation failure's (422) `errors` field by field, as Laravel sends them
// ({ field: [messages] }); "" when it says nothing. Credentials in either are
// masked.
export function ploiErrorDetail(payload) {
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  const errors = validationErrors(payload?.errors);
  return redactText([message, errors && `(${errors})`].filter(Boolean).join(" "));
}

function validationErrors(errors) {
  if (typeof errors === "string") return errors.trim();
  if (Array.isArray(errors)) return errors.map(String).join(" ");
  if (!errors || typeof errors !== "object") return "";
  return Object.entries(errors)
    .map(([field, messages]) => `${field}: ${[messages].flat().map(String).join(" ")}`)
    .join("; ");
}
