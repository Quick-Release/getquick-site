// Masks credentials in values gq prints from provider APIs, keeping the shape:
// every string and number under a field named as a secret (`password`,
// `private_key`, `apiToken`), and secret query parameters such as Ploi's
// deploy webhook `?token=` in any other string. Booleans and nulls stay, since
// they hold no secret and say whether one is set.
export const REDACTED = "[redacted]";

// A name is secret when one of its words is one of these, so `api_key`,
// `apiToken` and `X-Amz-Signature` all match.
const SECRET_FIELD_WORDS = new Set([
  ...["token", "password", "secret", "key", "private"],
  ...["tokens", "passwords", "secrets", "keys"],
]);
const SECRET_QUERY_WORDS = new Set(["token", "key", "secret", "signature"]);
const SECRET_ELEMENT_WORDS = new Set([...SECRET_FIELD_WORDS, "signature"]);

export function redactSecrets(value, { secret = false } = {}) {
  if (typeof value === "string") return secret ? REDACTED : redactQueryParameters(value);
  if (typeof value === "number") return secret ? REDACTED : value;
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry, { secret }));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [
        name,
        redactSecrets(entry, { secret: secret || isSecretName(name, SECRET_FIELD_WORDS) }),
      ]),
    );
  }
  return value;
}

// A provider's free text (an error body, a CLI's stderr) with its secret
// query parameters masked, and every XML element named as a secret (S3's
// <AWSAccessKeyId>, <SignatureProvided>).
export function redactText(text) {
  return redactQueryParameters(text).replace(/<([A-Za-z][\w-]*)>([^<]*)<\/\1>/g, (match, name) =>
    isSecretName(name, SECRET_ELEMENT_WORDS) ? `<${name}>${REDACTED}</${name}>` : match,
  );
}

function redactQueryParameters(text) {
  return text.replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, separator, name) =>
    isSecretName(name, SECRET_QUERY_WORDS) ? `${separator}${name}=${REDACTED}` : match,
  );
}

function isSecretName(name, words) {
  return nameWords(name).some((word) => words.has(word));
}

// `api_key`, `apiKey`, `X-Amz-Signature` → their lowercase words.
function nameWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
