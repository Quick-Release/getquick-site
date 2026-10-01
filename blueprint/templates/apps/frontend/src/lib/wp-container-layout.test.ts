import { describe, expect, it } from "vite-plus/test";
import { containerLayoutHtml } from "./wp-container-layout";
import { renderWordPressBlocks } from "./wp-block-renderer";

const shell =
  '<div id="section" class="wp-block-getquick-design-container alignfull" style="color:red"></div>';

describe("native container layout", () => {
  it("leaves every untouched legacy shell byte-for-byte unchanged", () => {
    for (const attributes of [
      {},
      { layout: null },
      { layout: {} },
      { style: { spacing: { blockGap: "" } } },
    ]) {
      expect(containerLayoutHtml(shell, attributes)).toBe(shell);
    }
  });

  it("preserves wrapper attributes while exporting flow presets and zero gaps", () => {
    const html = containerLayoutHtml(shell, {
      style: { spacing: { blockGap: "var:preset|spacing|md" } },
    });
    expect(html).toContain('id="section"');
    expect(html).toContain("alignfull gqd-container-layout");
    expect(html).toContain("color:red;--gqd-layout-content:");
    expect(html).toContain("--gqd-layout-gap:var(--wp--preset--spacing--md)");
    expect(containerLayoutHtml(shell, { style: { spacing: { blockGap: 0 } } })).toContain(
      "--gqd-layout-gap:0",
    );
  });

  it("exports constrained widths, justification, padding breakout and vertical object gap", () => {
    const html = containerLayoutHtml(shell, {
      layout: {
        type: "constrained",
        contentSize: "40rem",
        wideSize: "60rem",
        justifyContent: "right",
      },
      style: { spacing: { blockGap: { top: "2rem", left: "99rem" }, padding: { right: "1rem" } } },
    });
    for (const declaration of [
      "content:40rem",
      "wide:60rem",
      "gap:2rem",
      "left:auto",
      "right:0",
      "padding-right:1rem",
    ]) {
      expect(html).toContain(`--gqd-layout-${declaration}`);
    }
    expect(html).not.toContain("99rem");
    expect(html).toContain("gqd-container-layout--constrained");
  });

  it("matches core's single-size fallback and legacy inherit", () => {
    const html = containerLayoutHtml(shell, { layout: { inherit: true, wideSize: "50rem" } });
    expect(html).toContain("--gqd-layout-content:50rem");
    expect(html).toContain("--gqd-layout-wide:50rem");
  });

  it("resets nested variables and preserves rendered CMS defaults", () => {
    const rendered = containerLayoutHtml(shell, { layout: { type: "constrained" } });
    expect(containerLayoutHtml(rendered, { layout: { contentSize: "99rem" } })).toBe(rendered);
    const html = renderWordPressBlocks([
      {
        name: "getquick-design/container",
        htmlContent: shell,
        attributes: {
          layout: { type: "constrained", contentSize: "30rem" },
          style: { spacing: { blockGap: "3rem" } },
        },
        innerBlocks: [
          {
            name: "getquick-design/container",
            htmlContent: '<div class="wp-block-getquick-design-container"></div>',
            attributes: { layout: { type: "default" }, style: { spacing: { blockGap: "1rem" } } },
          },
        ],
      },
    ]);
    expect(html).toContain("--gqd-layout-gap:3rem");
    expect(html).toContain("--gqd-layout-gap:1rem");
    expect(html).toContain("--gqd-parent-layout-content:30rem");
    expect(html).toContain("--gqd-parent-layout-gap:3rem");
    expect(html).toContain("--gqd-layout-content:var(--wp--style--global--content-size, none)");
  });

  it("rejects CSS injection and does not invent unsupported flex/grid", () => {
    const html = containerLayoutHtml(shell, {
      layout: { type: "constrained", contentSize: "1rem;position:fixed" },
      style: { spacing: { blockGap: "url(https://bad.test)" } },
    });
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("bad.test");
    expect(containerLayoutHtml(shell, { layout: { type: "flex" } })).toBe(shell);
  });
});
