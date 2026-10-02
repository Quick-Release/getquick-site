## Parent

[Spec #38: event-refreshed published content for resilient new content sites](https://github.com/Quick-Release/gq-site/issues/38)

## What to build

A Site creator can explicitly prepare and verify independently hosted WordPress uploads for a new content Site, and visitors can still load uploaded assets when the CMS is offline. Reuse the existing R2 media provisioning and WordPress upload path; a cached HTML document is not itself a media-availability guarantee.

Independent of the content-cache implementation: test the upload destination and public asset through the existing rendered Frontend. The final new-Site preparation ticket consumes this readiness outcome.

Scope: new content Sites on the supported GETQUICK WordPress/Astro stack. Preserve offline, secret-free generation and create-once/site-owned applications. Do not resolve the shared-renderer package-home decision or automatically migrate existing Sites.

## Acceptance criteria

- [ ] A new content Site has an explicit, repeatable preparation/check path for its existing R2 media resources and WordPress upload configuration, using the established per-command secret authority model.
- [ ] Upload representative media through a compatible WordPress CMS and verify the public asset destination is independently hosted rather than on the CMS origin.
- [ ] With the CMS unreachable, the independent destination still serves the uploaded asset and a rendered Frontend page references that destination.
- [ ] Missing or incompatible independent-media configuration produces an actionable not-ready result for the production resilience guarantee, rather than silently declaring the Site resilient.
- [ ] Provisioning and checks do not expose secrets, silently reset an existing CMS, or overwrite site-owned extensions. Generation itself remains offline and secret-free.
- [ ] Retain ordinary local development with local uploads; distinguish local development readiness from the production independent-media prerequisite.
- [ ] Exercise the actual media adapter with disposable resources or the project's controlled integration environment, document the evidence and clean up test infrastructure. Do not claim that an origin rewrite alone proves the upload path.
- [ ] Run applicable generation, provisioning and media checks. Third-party media-provider outages remain outside the guarantee.

## Blocked by

None (can start immediately).
