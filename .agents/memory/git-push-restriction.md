---
name: Git push restriction (main agent)
description: Why git push fails from the main agent and how to actually push code to a remote.
---

The main agent is blocked by a platform guard from running ANY `git push` — not just
force pushes. Both `git remote add` and `git push -u` also fail because they write to
`.git/config` (the guard reports `.git/config.lock`). Pushing to an explicit URL with
an explicit refspec (no `-u`, no config write) is ALSO blocked. The error always says:
"Destructive git operations are not allowed in the main agent."

**Why:** Replit reserves destructive git ops for background Project Tasks (isolated
envs with elevated permissions) or for the user via the Replit Git pane.

**How to apply:** Do not retry git push from the main agent. To get code onto a remote:
either (1) hand the push to a background Project Task via the project_tasks skill (Plan
mode), or (2) ask the user to push via the Git pane in the Replit sidebar. Code commits
are auto-managed by the platform, so the working tree is usually already committed.
GitHub auth: the GitHub connector OAuth flow, or a user-supplied PAT stored as the
GITHUB_TOKEN secret, both work for auth — but the push itself is still guard-blocked.
