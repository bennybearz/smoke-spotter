# Deploy + share runbook

Goal: a live site on Cloudflare Pages that **auto-updates** whenever Aaron pushes code.
The repo is already created and committed locally — you just need to push it and connect it.

## Step 0 — clear a leftover lock (once)
A background process left a stale lock file. From the `smoke-spotter` folder:
```bash
rm -f .git/index.lock
```

## Step 1 — create an empty GitHub repo
Go to https://github.com/new and create a repo named **smoke-spotter**.
- Leave it **empty**: do NOT add a README, .gitignore, or license (we already have them).
- Public or private both work. Private is fine — you'll add Aaron and Cloudflare as collaborators.
- (Claude can drive this step in your browser once the Chrome extension is connected.)

## Step 2 — push the code (one time, from the smoke-spotter folder)
```bash
rm -f .git/index.lock                            # clears the leftover lock
git add -A && git commit -m "Add deploy docs"    # picks up any uncommitted files
git remote add origin https://github.com/bennybearz/smoke-spotter.git
git push -u origin main
```
(The push will ask you to authenticate with GitHub — that's expected.)
This is the only terminal step. Web upload is avoided on purpose — it would flatten the
`vendor/` and `test/` folders and break the app.

## Step 3 — connect Cloudflare Pages (auto-deploy)
1. https://dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → authorize GitHub → pick **smoke-spotter**.
2. Build settings — this is a plain static site, so:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
3. **Save and Deploy.** You get a URL like `https://smoke-spotter.pages.dev`.
4. Every future `git push` to `main` redeploys automatically.

## Step 4 — give Aaron access
- **Code:** GitHub repo → **Settings → Collaborators → Add people** → invite Aaron.
  He clones, edits, pushes — and the site redeploys itself.
- Aaron's quick start is in `README.md` under "Developer notes" (local run + how to test).
- If you'd rather review his changes before they go live, have him push to a branch and
  open a Pull Request instead of pushing straight to `main`.

## Install on your phones
Open the `pages.dev` link in Safari → Share → **Add to Home Screen**. Allow Location.
