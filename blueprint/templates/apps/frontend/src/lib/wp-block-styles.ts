interface Preset {
  slug: string;
}

const validSlug = (slug: string) => /^[a-z0-9][a-z0-9-]*$/.test(slug);

/** WordPress preset classes need the CMS palette as well as CSS variables. */
export function blockPresetStyles(
  spacingSizes: Array<Preset & { size: string }>,
  colors: Array<Preset & { color: string }>,
) {
  const vars: Record<string, string> = {};
  const colorRules: string[] = [];

  for (const { slug, size } of spacingSizes) {
    if (validSlug(slug)) vars[`--wp--preset--spacing--${slug}`] = size;
  }

  for (const { slug, color } of colors) {
    if (!validSlug(slug)) continue;
    vars[`--wp--preset--color--${slug}`] = color;
    colorRules.push(
      `.prose-wp .has-${slug}-color{color:var(--wp--preset--color--${slug})}`,
      `.prose-wp .has-${slug}-background-color{background-color:var(--wp--preset--color--${slug})}`,
      `.prose-wp .has-${slug}-color.has-link-color a{color:var(--wp--preset--color--${slug})}`,
    );
  }

  return { vars, colorRules: colorRules.join("\n") };
}
