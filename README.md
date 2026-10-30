# QueryHub

A small, fast, dependency-free website for keeping KQL queries where you can
read them from any device. Hosted on GitHub Pages; the "database" is a JSON
file in this repo, so every change is versioned by git.

Features:

- Title, description, tags, query text, and a status (Fully works / Mostly
  works / Doesn't work) with a color per status.
- Full-text search across title, description, query text, and tags, plus a
  status filter. Press `/` to jump to the search box.
- KQL syntax highlighting and a heuristic syntax checker (see below).
- Optional sample results shown as a table under each query.
- Add / edit / delete queries in the browser, then download the updated JSON
  and commit it.
- Light and dark theme; all colors and fonts live in `data/settings.json`.

## Hosting on GitHub Pages

1. Push this repo to GitHub.
2. In the repo go to **Settings > Pages**, set **Source** to "Deploy from a
   branch", pick `main` and the `/ (root)` folder, and save.
3. After a minute the site is live at `https://<user>.github.io/QueryHub/`.

No build step, no npm, no external CDNs. The `.nojekyll` file tells Pages to
serve the files exactly as they are.

## Adding or editing queries

The data lives in `data/queries.json`. There are two ways to change it.

**In the browser (recommended):**

1. Click **Add query** (or **Edit** on a card), fill in the form, click **Save**.
2. A banner appears saying you have unsaved changes. They are kept in this
   browser's local storage so a refresh does not lose them, but no other device
   can see them yet.
3. Click **Download queries.json** (or **Copy JSON**).
4. Commit the file to `data/queries.json` in the repo. The quickest way is the
   **Edit data on GitHub** button in the header, which opens the file in
   GitHub's web editor: paste the copied JSON, commit, done.
5. Once Pages redeploys and the published file matches your local copy, the
   banner disappears automatically.

**Directly in the JSON:** add an object to the `queries` array:

```json
{
  "id": "any-unique-id",
  "title": "Failed sign-ins by user",
  "status": "works",
  "tags": ["entra", "signinlogs"],
  "description": "What it does and any caveats.",
  "query": "SigninLogs\n| where ResultType != \"0\"\n| summarize count() by UserPrincipalName",
  "sampleResults": {
    "columns": ["UserPrincipalName", "count_"],
    "rows": [["jdoe@contoso.com", "14"]]
  },
  "updated": "2026-10-30"
}
```

`status` must be one of `works`, `mostly`, `broken`. `sampleResults` and
`tags` are optional. Records with a missing title or query are skipped.

In the editor, sample results are entered as tab-separated text with the
header on the first line. Copying rows from the Log Analytics results grid
and pasting them in produces exactly that format.

## Settings

`data/settings.json` controls:

- `siteTitle`, `tagline`
- `repoUrl` and `defaultBranch` (used for the Edit data on GitHub link;
  leave `repoUrl` empty to hide the link)
- `fontFamily`, `monoFontFamily`, `baseFontSize`, `codeFontSize`
- `statuses` labels and colors
- `theme.light` and `theme.dark` palettes, including `syntax` colors for
  highlighting

Values are validated before use (no `url(...)`, braces, or semicolons), and
unknown keys are ignored.

## Syntax checker

The checker in `js/lint.js` is a lightweight heuristic, not the real Kusto
parser. It reports:

- unbalanced or mismatched brackets, unterminated strings
- empty pipe segments, queries that start with `|` or with an operator such
  as `where`
- unknown operators after `|`, with a "did you mean" suggestion for typos
- trailing commas and clauses that end in `by`, `and`, `on`, etc.
- `let` statements missing `;`, or a query that ends after a `let`
- `where` clauses using a single `=`
- `take`/`limit` without a count, `sort`/`top` without `by`, `join` without
  `on`, unknown `render` chart types

It does not know your tables, columns, or function signatures, so a clean
result means "structurally plausible", not "will run".

## Security notes

- No server, no login, no third-party scripts or fonts. Everything is served
  from this repo over HTTPS by GitHub Pages.
- A strict Content-Security-Policy blocks inline scripts, `eval`, and any
  external resource.
- Query data is only ever rendered through `textContent` and DOM nodes, never
  `innerHTML`, so a query containing `<script>` is displayed as text.
- Every record and every setting is validated and length-limited on load.
- Nothing is sent anywhere. Edits stay in your browser until you commit them.

## Running locally

ES modules need an HTTP server (opening `index.html` directly via `file://`
will not load the data). From the repo folder:

```
python runner.py
```

This serves the site on `http://localhost:8000/` (or the next free port),
opens your browser, and disables caching so edits show up on refresh.
Pass a port to use a different one: `python runner.py 9000`.

## Layout

```
index.html           page shell (all markup, no inline script)
css/styles.css       layout; colors come from settings.json at runtime
data/queries.json    the query database
data/settings.json   colors, fonts, labels, repo link
js/main.js           entry point, app state, event wiring
js/config.js         settings loading, validation, theme application
js/data.js           query loading, validation, serialization, TSV parsing
js/search.js         text + status filtering
js/tokenizer.js      KQL tokenizer shared by highlighter and linter
js/highlight.js      syntax highlighting
js/lint.js           heuristic syntax checker
js/render.js         cards, result tables, lint output
js/editor.js         add/edit dialog
js/storage.js        localStorage wrapper (working copy, theme)
js/dom.js            element helpers, clipboard
```
