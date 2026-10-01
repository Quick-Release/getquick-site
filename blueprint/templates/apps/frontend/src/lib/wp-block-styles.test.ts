import { expect, test } from "vite-plus/test";
import { blockPresetStyles } from "./wp-block-styles";

test("exposes CMS spacing and colors to saved WordPress block classes", () => {
  const { vars, colorRules } = blockPresetStyles(
    [{ slug: "md", size: "2rem" }],
    [{ slug: "accent", color: "#2563eb" }],
  );

  expect(vars).toEqual({
    "--wp--preset--spacing--md": "2rem",
    "--wp--preset--color--accent": "#2563eb",
  });
  expect(colorRules).toContain(
    ".prose-wp .has-accent-color{color:var(--wp--preset--color--accent)}",
  );
  expect(colorRules).toContain(
    ".prose-wp .has-accent-background-color{background-color:var(--wp--preset--color--accent)}",
  );
  expect(colorRules).toContain(
    ".prose-wp .has-accent-color.has-link-color a{color:var(--wp--preset--color--accent)}",
  );
});

test("rejects unsafe token slugs before building CSS selectors", () => {
  const styles = blockPresetStyles([], [{ slug: "a}body{display:none", color: "red" }]);
  expect(styles).toEqual({ vars: {}, colorRules: "" });
});
