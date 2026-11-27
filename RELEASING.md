# Release procedure

The public v1.0.0 tag contains plugin version 1.0.0.0. New tags and archive names use the same four-part version as `version.xml`.

1. Update `version.xml`, the README release links and the changelog.
2. Open a pull request. The Checks workflow runs the existing static checks and builds a verified installable archive with MD5 and SHA-256.
3. Download the `mobile-dashboard-release` artifact and verify fresh installation and upgrade from the previous release on a disposable OJS 3.5.0-6 instance. Check that assets load when enabled, that disabling restores the standard layout, and that mobile and desktop behavior is unchanged.
4. After merge and validation, run the Checks workflow manually on `main` with `publish` enabled. It runs CI again before publishing the tag, archive and checksums.
5. Update the existing PKP Plugin Gallery entry with the exact version, archive URL and MD5.

The browser integration suite in [tests/README.md](tests/README.md) requires a local disposable OJS environment and does not run in CI. Static and packaging checks are not a substitute for installation or upgrade testing.
