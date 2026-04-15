# Required GitHub Secrets

Set these in GitHub → Settings → Secrets and Variables → Actions:

| Secret | Value | Source |
|--------|-------|--------|
| `RENDER_DEPLOY_HOOK_URL` | From Render dashboard → Service → Settings → Deploy Hooks | Render |
| `VERCEL_TOKEN` | `vcp_2Tg4vP66...` | master.env |
| `VERCEL_ORG_ID` | `team_FogQCXaut...` | master.env |
| `VERCEL_PROJECT_ID` | From Vercel project settings | Vercel dashboard |

## How to Get Render Deploy Hook
1. Go to render.com → your backend service
2. Settings → Deploy Hooks → Create Deploy Hook
3. Copy the URL → add as RENDER_DEPLOY_HOOK_URL secret
