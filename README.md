# Business Platform Public CI Mirror

This repository is a generated, read-only CI mirror of selected non-sensitive source files from the private Business-Platform-Project repository.

- Do not develop directly in this repository.
- The private repository is the sole source of truth.
- The mirror intentionally excludes browser profiles, authentication state, publication data, diagnostics, screenshots, product/content data, and authorization configuration.
- The test suite uses synthetic identities only.
- Source commit: `78f2d459c6a9e1dde09e1c8768ee19f6e1ef3f39`

Changes are generated one-way from the private repository. The public repository pulls the allowlisted snapshot using a read-only private-source credential, so private-repository Actions minutes are not required for normal synchronization. The sync workflow validates the generated snapshot with the public smoke test before committing it. Public CI failures are signals only and never write back to the private source.
