# Stitch Setter

Design knitted-type book covers on a real knitting chart and export photoreal knitted cover art
(front cover or full wrap: back, spine, front).

- `src/model/` — document model (trim sizes, wrap/spine/bleed, layers) and chart composition
- `src/render/` — WebGL2 knit renderer (plied yarn stitch model, lighting, tiled print export)
- `src/app/` — the studio UI
- `ARCHITECTURE.md` — how the pieces fit together

## Run it locally

```sh
npm install
npm run build        # writes site/index.html (website) and dist/stitch-setter.html (Claude artifact)
npx serve site       # or open site/index.html directly in Chrome
```

Tests: `npm test` (model) and `npm run test:e2e` (Playwright, needs Playwright + Chromium installed).

## Deploy to knit.liam.site

It's a static site: one file, `site/index.html`, no server.

**Build settings for any static host**
- Build command: `npm run build`
- Output / publish directory: `site`
- Node version: 20 or newer

**Cloudflare Pages** (easiest if liam.site's DNS is on Cloudflare)
1. Push this folder to a GitHub repo.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → pick the repo, use the build settings above.
3. The project → Custom domains → Set up a domain → `knit.liam.site`. Cloudflare adds the DNS record for you.

**Netlify**
1. Push to GitHub, then Netlify → Add new site → Import from Git → same build settings (`netlify.toml` already sets them).
2. Domain management → Add a domain → `knit.liam.site`.
3. At your DNS provider add `CNAME  knit  →  <your-site>.netlify.app`.

**Vercel**
1. Import the GitHub repo; framework preset "Other"; build `npm run build`, output `site` (`vercel.json` already sets them).
2. Settings → Domains → `knit.liam.site`, then add the `CNAME knit → cname.vercel-dns.com` record it shows.

**No GitHub, just drag and drop:** run `npm run build`, then drag the `site` folder onto
Netlify Drop (app.netlify.com/drop) or Cloudflare Pages → Upload assets. Add the custom domain as above.
Each update means re-uploading, so the Git route is better long-term.

## Git history

The full development history is in `stitch-setter.bundle`. To make this folder a git repo with that history:

```sh
cd stitch-setter
git init -b main
git fetch stitch-setter.bundle main
git reset FETCH_HEAD        # adopts the history; your files stay as they are
rm stitch-setter.bundle
```

Then create an empty GitHub repo and `git remote add origin … && git push -u origin main`.
