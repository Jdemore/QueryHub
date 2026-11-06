# QueryHub

A small, fast, dependency-free website for a team to share queries and
scripts: KQL, SQL, PowerShell, and Command Prompt. The page is static
(GitHub Pages); the data lives in a free hosted Postgres database (Supabase)
that the page talks to directly. Saves are instant and every device sees
them on its next load or when you switch back to the tab.

Features:

- Title, description, tags, code, and the author's status (Fully works /
  Mostly works / Doesn't work) with a color per status.
- A language per entry: KQL (.kql), SQL (.sql), PowerShell (.ps1), Command
  Prompt (.cmd). KQL entries can also name a platform: Sentinel Logs or
  Defender Threat Hunting.
- Full-text search across title, description, code, tags, language, and
  platform, plus language and status filters. Press `/` to jump to the
  search box.
- Syntax highlighting and a heuristic syntax checker for every language
  (see below).
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
   `setup/schema.sql` and run it. It contains no secrets and is safe to
   re-run.
3. Copy `setup/secrets.example.sql` to `setup/secrets.sql` (git ignores
   that name) and fill in the invite code. Leave the admin username for
   step 3. Run it the same way. The invite code is stored only as a bcrypt
   hash; the plaintext lives only in your private copy. Never paste it into
   a committed file.
4. Optional: run `setup/seed.sql` the same way to load the six starter
   queries.

### 2. Auth settings

**Authentication > Sign In / Providers**, under Email:

- **Allow new users to sign up: ON.** The invite code enforced inside the
  database is what keeps strangers out, not this switch.
- **Confirm email: OFF.** This one is required. Accounts use synthetic
  addresses; with confirmation on, Supabase tries to mail them and rejects
  the sign-up with "Email address ... is invalid".
- Leave the minimum password length at 6 (the PIN length).

### 3. Create your admin account

Every account, including yours, is created through the site. Do not use
"Add user" or "Invite user" in the dashboard: the invite-code trigger
rejects those on purpose, with "Database error creating new user".
r
1. Finish step 4 below so the site is live, open it, click **Sign in**,
   then the **Sign up** tab. Enter your username, a 6-digit PIN, and the
   invite code.
2. Put that username in `setup/secrets.sql` where it says
   `PUT-ADMIN-USERNAME-HERE` and run the file again. You are now admin, and
   the starter queries are owned by you.

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

**Changing the invite code or adding admins.** Edit your private
`setup/secrets.sql` and re-run it, or run directly in the SQL editor:

```sql
update public.app_config
set value = extensions.crypt('NEW-CODE', extensions.gen_salt('bf'))
where key = 'invite_code_hash';

update public.profiles set is_admin = true where username = 'someone';
```

If the code is ever exposed (for example committed by mistake), rotate it
this way; the old one stops working immediately.

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

## Languages and syntax checkers

Each language lives in one file under `js/languages/` that exports a
tokenizer (used for highlighting) and a checker. The checkers are
lightweight heuristics, not real parsers. They catch structural mistakes
and the slips that are common in each language. None of them know your
tables, columns, cmdlets, or programs, so a clean result means
"structurally plausible", not "will run".

Every language reports unbalanced brackets, unterminated strings and block
comments, and curly "smart" quotes pasted from documents or chat.

**KQL** (`kql.js`)

- empty pipe segments, queries that start with `|` or with an operator such
  as `where`
- unknown operators after `|`, with a "did you mean" suggestion
- trailing commas and clauses that end in `by`, `and`, `on`, etc.
- `let` statements missing `;`, or a query that ends after a `let`
- `where` clauses using a single `=`
- `take`/`limit` without a count, `sort`/`top` without `by`, `join` without
  `on`, unknown `render` chart types
- platform hints: `TimeGenerated` on Defender hunting tables, or `Timestamp`
  on Sentinel tables, when the entry's platform says otherwise

**SQL** (`sql.js`, T-SQL flavored and tolerant of other dialects)

- statements that start with a misspelled or misplaced keyword (`SELCT`,
  `FROM ...`)
- trailing or doubled commas, an empty `SELECT` list
- clauses out of order (`WHERE` after `GROUP BY`), `GROUP`/`ORDER` without
  `BY`, statements that end mid-clause
- `= NULL` comparisons, `JOIN` without `ON`
- `UPDATE` or `DELETE` with no `WHERE`

**PowerShell** (`powershell.js`)

- C-style operators (`==`, `!=`, `<=`, `>=`) and wordy ones (`-equals`)
- `=`, `>` or `<` inside an `if`/`while` condition, misspelled operators
  such as `-conatins`
- `if`/`while` without parentheses, `else if` instead of `elseif`, `try`,
  `else`, `finally`, `do` without `{`
- pipelines that end in `|`, misspelled keywords such as `fucntion`

**Command Prompt** (`cmd.js`)

- unbalanced `( )` blocks, `else` on its own line
- `goto` / `call :label` pointing at a label that does not exist
- `if` using `=` instead of `==`, or with no comparison at all
- `for` missing `in` or `do`, or using `%i` where a script needs `%%i`
- `set NAME = value` (the space becomes part of the name)
- misspelled built-ins such as `ehco`

**Adding a language:** write `js/languages/<name>.js` exporting
`tokenize(src)` and `lint(src, options)` (use the helpers in `shared.js`),
add it to the registry in `js/languages/index.js`, and add its key to the
`queries_language_check` constraint in `setup/schema.sql`.

## Upgrading an existing database

`setup/schema.sql` is written to be re-run. After pulling a version that
adds columns (languages and platforms were added this way), run it again
**before** deploying the new site. Existing entries default to KQL. Until
it is run, the site shows "The database is missing newer columns".

You can paste it into the Supabase SQL editor, or apply it from your
machine without opening the dashboard:

```
python setup/apply.py
```

This runs `schema.sql`, then your private `secrets.sql` if it exists. Pass
file paths to run something else, for example
`python setup/apply.py setup/seed.sql`. It needs a Supabase personal access
token, created once at <https://supabase.com/dashboard/account/tokens> and
saved in `setup/.supabase-token` (git ignores that file) or in the
`SUPABASE_ACCESS_TOKEN` environment variable. That token can manage your
whole Supabase account, so treat it like a password and never commit it.

## Backups

Supabase's free plan has no automatic backups, so take your own:

```
python setup/backup.py
```

This saves every entry, vote, comment, and username to a timestamped JSON
file in `backups/` (ignored by git). It needs no token because that content
is publicly readable. Each file is read back and checked before it counts,
and only then are older files pruned, so the folder always holds the three
newest verified backups. A run that fails, or that finds the database empty
when the last backup was not, writes nothing and deletes nothing. Pass a
folder path to save somewhere else.

Accounts and PINs are not included; they live in Supabase's private auth
tables. There is no restore script yet. A backup file holds the rows of
each table as plain JSON, ready to be re-inserted.

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
setup/schema.sql           tables, invite-code trigger, row-level security (no secrets)
setup/secrets.example.sql  template for the invite code and admin; copy to secrets.sql (gitignored)
setup/seed.sql             optional starter queries
setup/apply.py             run the SQL files against Supabase from your machine
setup/backup.py            save all content to backups/, keeping the 3 newest
setup/sample-queries.json  the starter queries as JSON (source of seed.sql)
runner.py                  local dev server
js/main.js                 entry point, app state, event wiring
js/db.js                   queries, votes, comments, profiles via Supabase REST
js/auth.js                 username/PIN sign-in, sign-up, token refresh
js/account.js              sign in / sign up / sign out dialog
js/config.js               settings loading, validation, theme application
js/data.js                 record validation, vote tally, TSV parsing
js/search.js               text, language, and status filtering
js/highlight.js            syntax highlighting (any language)
js/languages/index.js      language registry: labels, extensions, platforms
js/languages/shared.js     scanner, message collector, bracket and typo checks
js/languages/kql.js        KQL tokenizer and checker
js/languages/sql.js        SQL tokenizer and checker
js/languages/powershell.js PowerShell tokenizer and checker
js/languages/cmd.js        Command Prompt tokenizer and checker
js/render.js               cards, votes, comments, result tables, lint output
js/editor.js               add/edit dialog
js/storage.js              localStorage wrapper (session, theme)
js/dom.js                  element helpers, clipboard
```
