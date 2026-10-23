---
"branca-rs": minor
---

Drop Node.js 20 support. It reached end of life on 2026-04-30 and the build toolchain no longer runs on it. The minimum is now Node.js 22.12, the first 22.x release where `require()` of ES modules works without a flag.
