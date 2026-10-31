# QueryHub

A small, fast, dependency-free website for keeping KQL queries where you can
read and edit them from any device. The page is static (GitHub Pages); the
data lives in a free hosted Postgres database (Supabase) that the page talks
to directly. Saves are instant and every device sees them on its next load or
when you switch back to the tab.

Features:

- Title, description, tags, query text, and a status (Fully works / Mostly
  works / Doesn't work) with a color per status.
- Full-text search across title, description, query text, and tags, plus a
  status filter. Press `/` to jump to the search box.
- KQL syntax highlighting and a heuristic syntax checker (see below).
- Optional sample results shown as a table under each query.
- Add / edit / delete in the browser; anyone can read, only you can write.
- Light and dark theme; all colors and fonts live in `data/settings.json`.

## One-time setup

### 1. Create the database (about 10 minutes)

1. Sign up at <https://supabase.com> and create a new project on the free
   plan. Any name and region; the database password it asks for is not
   needed by the site, but keep it somewhere.
2. Open **SQL Editor**, click **New query**, paste the contents of
   `setup/schema.sql`. **Replace `you@example.com`** in the `is_editor`
   function with the email you will sign in with. Run it.
3. Optional: run `setup/seed.sql` the same way to load the six starter
   queries.

### 2. Create your sign-in account and lock down sign-ups

1. **Authentication > Users > Add user > Create new user.** Enter the same
   email you put in `schema.sql` and a strong password. Tick **Auto Confirm
   User**.
2. **Authentication > Sign In / Providers**, under Email, turn **off**
   "Allow new users to sign up". This stops anyone else from creating an
   account. (The `is_editor` check in the schema blocks writes from other
   accounts anyway, so this is belt and braces.)

### 3. Point the site at the database

1. **Project Settings > API** (also called Data API). Copy the **Project URL**
   and the **anon / public** key.
2. Put them in `data/settings.json`:

   ```json
   "supabase": {
     "url": "https://abcdefghijklmnop.supabase.co",
     "anonKey": "eyJ..."
   }
   ```

   The anon key is designed to be public. It only grants what the row-level
   security policies allow, which is read for everyone and write for signed-in
   editors.
3. Commit and push. Enable Pages if you have not: **Settings > Pages**,
   Source "Deploy from a branch", `main`, `/ (root)`.

### 4. Sign in on each device

Open the site, click **Sign in**, enter the email and password. The session
is kept in that browser's local storage and refreshes itself, so you do this
once per browser.

## Day-to-day use

Click **Add query** or **Edit** / **Delete** on a card. **Save** writes to the
database immediately; the status line under the search box confirms it with
a time. The page reloads the list after every save and whenever the tab
regains focus, so another PC shows the change as soon as you switch to it.

In the editor, sample results are entered as tab-separated text with the
header on the first line. Copying rows from the Log Analytics results grid
and pasting them in produces exactly that format.

Free-plan note: Supabase pauses a project after about a week with no
requests. Opening the site counts as a request, so normal use keeps it
awake. If it does pause, the site shows an error and you restore it with one
click in the Supabase dashboard; nothing is lost.

## Settings

`data/settings.json` controls:

- `siteTitle`, `tagline`
- `supabase.url` and `supabase.anonKey`
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

- No third-party scripts or fonts. The page is served from this repo over
  HTTPS, and the only network calls go to your Supabase project. The
  Content-Security-Policy pins `connect-src` to `*.supabase.co` and blocks
  inline scripts and `eval`.
- Write access is enforced by the database, not the page: row-level security
  allows inserts, updates, and deletes only for a signed-in user whose email
  is in the `is_editor` list. Someone who reads the anon key out of the page
  gets exactly what an anonymous visitor gets: read access.
- Query data is only ever rendered through `textContent` and DOM nodes, never
  `innerHTML`, so a query containing `<script>` is displayed as text.
- Every record and every setting is validated and length-limited both in the
  page and by the table's check constraints.
- The session token is stored in the browser's local storage. Sign out on a
  shared machine. You can change the password or delete the user in the
  Supabase dashboard at any time.

## Running locally

ES modules need an HTTP server (opening `index.html` directly via `file://`
will not load the settings). From the repo folder:

```
python runner.py
```

This serves the site on `http://localhost:8000/` (or the next free port),
opens your browser, and disables caching so edits show up on refresh.
Pass a port to use a different one: `python runner.py 9000`. The local page
talks to the same Supabase database as the published one.

## Layout

```
index.html                 page shell (all markup, no inline script)
css/styles.css             layout; colors come from settings.json at runtime
data/settings.json         Supabase connection, colors, fonts, labels
setup/schema.sql           table, constraints, row-level security policies
setup/seed.sql             optional starter queries
setup/sample-queries.json  the starter queries as JSON (source of seed.sql)
runner.py                  local dev server
js/main.js                 entry point, app state, event wiring
js/db.js                   read/write the queries table via Supabase REST
js/auth.js                 email/password sign-in and token refresh
js/signin.js               sign-in dialog
js/config.js               settings loading, validation, theme application
js/data.js                 record validation, TSV parsing
js/search.js               text + status filtering
js/tokenizer.js            KQL tokenizer shared by highlighter and linter
js/highlight.js            syntax highlighting
js/lint.js                 heuristic syntax checker
js/render.js               cards, result tables, lint output
js/editor.js               add/edit dialog
js/storage.js              localStorage wrapper (session, theme)
js/dom.js                  element helpers, clipboard
```
