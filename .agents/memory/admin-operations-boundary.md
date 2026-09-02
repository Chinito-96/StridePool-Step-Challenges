---
name: Admin operations boundary
description: Access rule for internal StridePool support and operations tooling
---

Internal operations data must be read through endpoints that require both an authenticated session and an explicit `admin` role on the database user. Normal authenticated users remain outside the admin surface.

**Why:** Support data includes suspicious activity, wallet state, settlement history, and private challenge participation; authentication alone is not sufficient authorization.

**How to apply:** Keep the admin UI out of public navigation, enforce the role check server-side before every admin query, and default all new users to `user`.