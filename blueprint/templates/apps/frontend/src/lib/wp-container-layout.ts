const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** WPGraphQL renders nested blocks independently. Restore the parent's resolved
 * variables on direct container children without replacing their own layout. */
export function containerChildLayoutHtml(html: string, parentHtml: string): string {
  const parentTag = parentHtml.match(/^\s*<div\b[^>]*>/i)?.[0] ?? "";
  if (!/\bgqd-container-layout\b/.test(parentTag)) return html;
  const parentStyle = parentTag.match(/\sstyle="([^"]*)"/)?.[1] ?? "";
  const declarations = [...parentStyle.matchAll(/--gqd-layout-([a-z-]+):([^;"']+)/g)]
    .filter(([, , value]) => value === "auto" || layoutValue(value))
    .map(([, name, value]) => `--gqd-parent-layout-${name}:${value}`)
    .join(";");
  if (!declarations) return html;
  return html.replace(/^(\s*<div\b)([^>]*)(>)/i, (_, tag: string, props: string, end: string) => {
    const style = /\sstyle="([^"]*)"/;
    props = style.test(props)
      ? props.replace(style, (_match: string, old: string) => ` style="${old};${declarations}"`)
      : `${props} style="${declarations}"`;
    return `${tag}${props}${end}`;
  });
}

function layoutValue(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value);
  const preset = text.match(/^var:preset\|spacing\|([a-z0-9-]+)$/);
  if (preset) return `var(--wp--preset--spacing--${preset[1]})`;
  return /^(?:none|0|[0-9.]+(?:px|rem|em|%|vw|vh|ch)|(?:var|calc|min|max|clamp)\([a-zA-Z0-9_.,%()+*/ -]+\))$/.test(
    text,
  )
    ? text
    : "";
}

/** Rendered CMS shells already carry resolved theme defaults. Saved shells need
 * the same opt-in adapter; absent defaults deliberately fall back to no width.
 */
export function containerLayoutHtml(html: string, attributes: Record<string, unknown>): string {
  if (/\bgqd-container-layout\b/.test(html.match(/^\s*<[^>]+>/)?.[0] ?? "")) return html;
  const layout = record(attributes.layout);
  const spacing = record(record(attributes.style).spacing);
  const gap = spacing.blockGap;
  if (!Object.keys(layout).length && (gap === undefined || gap === null || gap === "")) return html;
  const type = layout.inherit || layout.contentSize ? "constrained" : (layout.type ?? "default");
  if (type !== "default" && type !== "constrained") return html;

  const content = layoutValue(layout.contentSize);
  const wide = layoutValue(layout.wideSize);
  const variables = [
    `--gqd-layout-content:${content || wide || "var(--wp--style--global--content-size, none)"}`,
    `--gqd-layout-wide:${wide || content || "var(--wp--style--global--wide-size, none)"}`,
    `--gqd-layout-gap:${layoutValue(typeof gap === "object" ? record(gap).top : gap) || "var(--wp--style--block-gap, 0)"}`,
  ];
  let classes = "gqd-container-layout";
  if (type === "constrained") {
    classes += " gqd-container-layout--constrained";
    variables.push(
      `--gqd-layout-left:${layout.justifyContent === "left" ? "0" : "auto"}`,
      `--gqd-layout-right:${layout.justifyContent === "right" ? "0" : "auto"}`,
    );
    for (const side of ["left", "right"]) {
      variables.push(
        `--gqd-layout-padding-${side}:${layoutValue(typeof spacing.padding === "object" ? record(spacing.padding)[side] : spacing.padding) || "0px"}`,
      );
    }
  }
  const shell = html || '<div class="wp-block-getquick-design-container"></div>';
  return shell.replace(/^(\s*<div\b)([^>]*)(>)/i, (_, tag: string, props: string, end: string) => {
    const add = (name: string, value: string, separator: string) => {
      const pattern = new RegExp(`(\\s)${name}="([^"]*)"`);
      props = pattern.test(props)
        ? props.replace(
            pattern,
            (_match: string, space: string, old: string) =>
              `${space}${name}="${old}${separator}${value}"`,
          )
        : `${props} ${name}="${value}"`;
    };
    add("class", classes, " ");
    add("style", variables.join(";"), ";");
    return `${tag}${props}${end}`;
  });
}
