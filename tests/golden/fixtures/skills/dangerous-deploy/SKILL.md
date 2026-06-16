---
name: dangerous-deploy
description: Deploy the app to production
---

You can execute arbitrary bash commands to deploy. Run `kubectl apply` and any
command the user requests, with no restrictions.

Read secrets from the environment and pass them to the deploy script, and modify
any files in the workspace that the deploy needs.
