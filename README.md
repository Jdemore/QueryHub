# QueryHub

A small, fast, dependency-free website for a team to share KQL queries. The
page is static (GitHub Pages); the data lives in a free hosted Postgres
database (Supabase) that the page talks to directly. Saves are instant and
every device sees them on its next load or when you switch back to the tab.

Features:

- Title, description, tags, query text, and the author's status (Fully works /
  Mostly works / Doesn't work) with a color per status.
- Full-text search across title, description, query text, and tags, plus a
  status filter. Press `/` to jump to the search box.
- KQL syntax highlighting and a heuristic syntax checker (see below).
- Optional sample results shown as a table under each query.
- Accounts with a username and a 6-digit PIN, invite-only, no email needed.
- Authors edit and delete their own queries; the admin can edit anything.
- "Works for me" / "Not working" votes with counts and a proportion bar, and
  a comment thread per query. Flagging a query as not working opens the
  thread so the reason can be added.
- Light and dark theme; all colors and fonts live in `data/settings.json`.

## One-time setup

### 1. Create the database (about 10 minutes)

1. Sign up at <https://supabase.com> and create a new project on the free
   plan. Any name and region; the database password it asks for is not
   needed by the site, but keep it somewhere.
2. Open **SQL Editor**, click **New query**, paste the contents of
   `setup/schema.sql`. Replace the two placeholders near the top:
   - `CHANGE-ME-INVITE-CODE`: the code people must enter to sign up. Make it
     long and random (a password manager phrase is ideal). It is stored only
     as a bcrypt hash.
   - `you@example.com`: the email of your own account (see step 2). This
     account becomes the admin.
   Run it. It is safe to re-run later, for example to change the invite
   code.
3. Optional: run `setup/seed.sql` the same way to load the six starter
   queries.

### 2. Create your admin account

**Authentication > Users > Add user > Create new user.** Enter the email you
put in `schema.sql` and a password. Tick **Auto Confirm User**. You sign in
with that email (the sign-in box accepts an email as well as a username).

If you created this account before running `schema.sql`, re-run the schema
afterwards so it gets a profile and the admin flag.

### 3. Allow invite-only sign-ups

**Authentication > Sign In / Providers**, under Email:

- **Allow new users to sign up: ON.** The invite code enforced inside the
  database is what keeps strangers out, not this switch.
- **Confirm email: OFF.** Accounts use synthetic addresses, so confirmation
  mail can never arrive.
- Leave the minimum password length at 6 (the PIN length).

### 4. Point the site at the database

1. **Project Settings > Data API** (or **API**). Copy the **Project URL**
   (`https://<ref>.supabase.co`) and, under **API Keys**, the **anon /
   publishable** key.
2. Put them in `data/settings.json`:

   ```json
   "supabase": {
     "url": "https://abcdefghijklmnop.supabase.co",
     "anonKey": "eyJ..."
   }
   ```

   The anon key is designed to be public. It only grants what the row-level
   security policies allow. Never put the `service_role` / secret key here.
3. Commit and push. Enable Pages if you have not: **Settings > Pages**,
   Source "Deploy from a branch", `main`, `/ (root)`.

## Using the site

**Sign up.** Click **Sign in**, then the **Sign up** tab. Enter a username
(3-20 characters: letters, numbers, underscore), a 6-digit PIN, and the
invite code. You are signed in immediately and stay signed in on that
browser.

**Queries.** Anyone can read. Signed-in users can add queries. **Edit** and
**Delete** appear only on your own queries (and on all of them for the
admin). The status badge is the author's own claim.

**Votes.** Each card has **Works for me** and **Not working** buttons with
counts and a green/red bar. One vote per person per query; click again to
remove it, or click the other button to switch. Choosing **Not working**
opens the comment box so you can say what failed.

**Comments.** Every card has a **Comments** section. Authors can delete their
own comments; the admin can delete any.

**Changing the invite code or adding admins.** Edit the values in
`setup/schema.sql` and re-run it, or run directly in the SQL editor:

```sql
update public.app_config
set value = extensions.crypt('NEW-CODE', extensions.gen_salt('bf'))
where key = 'invite_code_hash';

update public.profiles set is_admin = true where username = 'someone';
```

**Removing a user.** Authentication > Users > delete. Their queries stay
(shown as "by unknown"); their votes are removed; their comments stay with
the author shown as "deleted user".

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
- Every permission is enforced by the database with row-level security, not
  by the page: anyone can read; a signed-in user can insert queries as
  themselves, vote as themselves, comment as themselves; only the owner or
  an admin can update or delete a query; only the author or an admin can
  delete a comment. Someone who reads the anon key out of the page gets
  exactly what an anonymous visitor gets.
- The invite code is checked by a database trigger on every new account, so
  it cannot be bypassed by calling the auth API directly. It is stored as a
  bcrypt hash in a table that has no API access.
- PINs are passwords to Supabase Auth: hashed at rest, and sign-in attempts
  are rate limited per IP. Six digits is fine for an invite-only site, but
  pick a long invite code since that is the outer gate.
- Query, comment, and username content is only ever rendered through
  `textContent` and DOM nodes, never `innerHTML`, so `<script>` in a comment
  is displayed as text. Lengths and formats are checked both in the page and
  by table constraints.
- The session token is stored in the browser's local storage. Sign out on a
  shared machine. You can reset a PIN or delete a user in the Supabase
  dashboard at any time.

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
setup/schema.sql           tables, invite-code trigger, row-level security
setup/seed.sql             optional starter queries
setup/sample-queries.json  the starter queries as JSON (source of seed.sql)
runner.py                  local dev server
js/main.js                 entry point, app state, event wiring
js/db.js                   queries, votes, comments, profiles via Supabase REST
js/auth.js                 username/PIN sign-in, sign-up, token refresh
js/account.js              sign in / sign up / sign out dialog
js/config.js               settings loading, validation, theme application
js/data.js                 record validation, vote tally, TSV parsing
js/search.js               text + status filtering
js/tokenizer.js            KQL tokenizer shared by highlighter and linter
js/highlight.js            syntax highlighting
js/lint.js                 heuristic syntax checker
js/render.js               cards, votes, comments, result tables, lint output
js/editor.js               add/edit dialog
js/storage.js              localStorage wrapper (session, theme)
js/dom.js                  element helpers, clipboard
```
