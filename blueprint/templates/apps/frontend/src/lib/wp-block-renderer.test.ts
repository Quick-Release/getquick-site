import { expect, test } from "vite-plus/test";
import {
  hasVideoHero,
  parseWordPressBlocks,
  renderWordPressBlocks,
  youtubeVideoId,
} from "./wp-block-renderer";

const videoHero = {
  name: "getquick-design/video-hero",
  attributes: {
    videoType: "self-hosted",
    videoId: 42,
    videoUrl: "https://media.example.test/intro.mp4?token=abc&size=large",
    posterId: 7,
    posterUrl: "https://media.example.test/intro-poster.jpg",
  },
  htmlContent: '<section class="wp-block-getquick-design-video-hero alignfull"></section>',
  innerBlocks: [
    {
      name: "core/heading",
      attributes: { level: 1 },
      htmlContent: '<h1 class="wp-block-heading">Welcome</h1>',
      innerBlocks: [],
    },
  ],
};

test("parses WPGraphQL Blocks JSON strings and retains every attribute", () => {
  const blocks = parseWordPressBlocks(JSON.stringify([videoHero]));

  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.attributes).toMatchObject(videoHero.attributes);
  expect(hasVideoHero(blocks)).toBe(true);
});

test("renders a self-hosted looping video with poster and inner blocks from GraphQL", () => {
  const html = renderWordPressBlocks([videoHero]);

  expect(html).toContain('class="wp-block-getquick-design-video-hero alignfull"');
  expect(html).toContain('src="https://media.example.test/intro.mp4?token=abc&amp;size=large"');
  expect(html).toContain('poster="https://media.example.test/intro-poster.jpg"');
  expect(html).toMatch(/autoplay muted loop playsinline preload="metadata"/);
  expect(html).not.toContain("controls");
  expect(html).toContain('<h1 class="wp-block-heading">Welcome</h1>');
});

test("renders unlisted YouTube URLs as muted looping privacy-enhanced embeds", () => {
  const blocks = [
    {
      ...videoHero,
      attributes: {
        videoType: "youtube",
        videoUrl: "https://youtu.be/abcdefghijk?si=share-token",
      },
    },
  ];
  const html = renderWordPressBlocks(blocks);

  expect(html).toContain("https://www.youtube-nocookie.com/embed/abcdefghijk?");
  expect(html).toContain("autoplay=1");
  expect(html).toContain("mute=1");
  expect(html).toContain("controls=0");
  expect(html).toContain("loop=1");
  expect(html).toContain("playlist=abcdefghijk");
  expect(html).toContain("playsinline=1");
  expect(html).toContain('tabindex="-1"');
});

test("rejects invalid media URLs and falls back to the poster", () => {
  const html = renderWordPressBlocks([
    {
      ...videoHero,
      attributes: {
        videoType: "youtube",
        videoUrl: "javascript:alert(1)",
        posterUrl: "https://media.example.test/poster.jpg",
      },
    },
  ]);

  expect(html).toContain('src="https://media.example.test/poster.jpg"');
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<iframe");
});

test("validates YouTube URL hosts and video IDs", () => {
  expect(youtubeVideoId("https://www.youtube.com/watch?v=abcdefghijk&t=10")).toBe("abcdefghijk");
  expect(youtubeVideoId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
  expect(youtubeVideoId("https://youtube.com.evil.test/watch?v=abcdefghijk")).toBe("");
  expect(youtubeVideoId("https://youtu.be/too-short")).toBe("");
});

test("reconstructs wrappers from block HTML and renders unknown content as-is", () => {
  const html = renderWordPressBlocks([
    {
      name: "core/group",
      htmlContent: '<div class="wp-block-group"></div>',
      innerBlocks: [
        {
          name: "core/paragraph",
          htmlContent: "<p>Inside</p>",
          innerBlocks: [],
        },
      ],
    },
    {
      name: "core/cover",
      htmlContent: '<div class="wp-block-cover"><p>Already rendered</p></div>',
      innerBlocks: [{ name: "core/paragraph", htmlContent: "<p>Do not duplicate</p>" }],
    },
    { name: "vendor/unknown", htmlContent: "<div>Fallback</div>" },
  ]);

  expect(html).toContain('<div class="wp-block-group"><p>Inside</p></div>');
  expect(html).toContain("Already rendered");
  expect(html).not.toContain("Do not duplicate");
  expect(html).toContain("<div>Fallback</div>");
});
