# workers-ai-claude-desktop

A custom gateway for Claude Desktop (in 3P mode) that relays all calls to Workers AI models (via Cloudflare Workers AI binding and Cloudflare AI Gateway) back to Claude Desktop.

## Worker deployment

`WORKER_DEPLOY_CF_API_TOKEN`

| Scope   | Permission name | Level | Description                                  |
| ------- | --------------- | ----- | -------------------------------------------- |
| Account | Workers Scripts | Write | To uplaod worker itself                      |
| Zone    | Workers Routes  | Read  | To set route for worker to be available on   |
| Zone    | API Gateway     | Write | To upload API Gateway schemas to validate on |

## Cloudflare Zero Trust Auth

1. Go to your ZT Dashboard and on the sidebar go to `Access controls` > `Applications`
2. Click on `Create new application` in the top right
3. Choose `SaaS applications` tab, then `Continue with SaaS applications`
4. Give your application name (doens't matter as long as you recognize it) and select `OIDC`
5. Set scopes to `openid` `email` `profile`
6. Pick any unused port and set `Redirect URLs` to `http://127.0.0.1:<port>/callback` (must use `127.0.0.1` not `localhost` or else you get redirect request not matching error)
7. Enable PKCE and PKCE without client secret
8. Expand `Advanced settings` and set `Access token lifetime` to a low value, but enable `Refresh tokens` and set that to a larger value.
9. Set your access policies/login methods/experience settings
10. Save application, but go back to that page so we can copy values for Claude Desktop

## Claude Desktop Setup

1. Follow the `Installation and setup` instructions from Claude (https://claude.com/docs/third-party/claude-desktop/installation) until step 2 on it.
2. Set `Gateway base URL` to your deployed worker url.
3. Set `Credential kind` to `Interactive sign-in`
4. Set `Sign-in session lifetime` to your `Access token lifetime` from step 8 above
5. Set `Client ID` in Claude to `Client ID` from ZT
6. Set `Issuer URL` in Claude to `Issuer` from ZT
7. Leave `Scopes` blank (should default to grey-ed out `openid profile email offline_access`)
8. Set `Redirect port` to the port you chose from step 6 above
9. Apply changes and restart Claude Desktop
10. Test it out and if all is good, go back to the Claude instructions (from step 1) and continue through for your deployment on other devices (if you want).
