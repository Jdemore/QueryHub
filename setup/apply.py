"""Apply QueryHub SQL files to the Supabase project without the dashboard.

Usage (from the repo root):

    python setup/apply.py                  # schema.sql, then secrets.sql if present
    python setup/apply.py setup/seed.sql   # specific file(s), in order

It uses the Supabase Management API, which needs a personal access token:

    1. Create one at https://supabase.com/dashboard/account/tokens
    2. Save it in setup/.supabase-token (git ignores that file), or set the
       SUPABASE_ACCESS_TOKEN environment variable.

The token can manage your whole Supabase account. Never commit it or paste
it anywhere else. The project is read from data/settings.json.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_FILE = os.path.join(ROOT, "setup", ".supabase-token")
SETTINGS_FILE = os.path.join(ROOT, "data", "settings.json")
API = "https://api.supabase.com/v1/projects/%s/database/query"


def read_token():
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token and os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, encoding="utf-8") as handle:
            token = handle.read().strip()
    if not token:
        raise SystemExit(
            "No access token found.\n"
            "Create one at https://supabase.com/dashboard/account/tokens and save it in\n"
            "  setup/.supabase-token\n"
            "or set the SUPABASE_ACCESS_TOKEN environment variable."
        )
    return token


def read_project_ref():
    with open(SETTINGS_FILE, encoding="utf-8") as handle:
        url = json.load(handle).get("supabase", {}).get("url", "")
    match = re.match(r"^https://([a-z0-9-]+)\.supabase\.co", url)
    if not match:
        raise SystemExit("data/settings.json has no valid supabase.url")
    return match.group(1)


def default_files():
    files = [os.path.join(ROOT, "setup", "schema.sql")]
    secrets = os.path.join(ROOT, "setup", "secrets.sql")
    if os.path.exists(secrets):
        files.append(secrets)
    return files


def run_sql(ref, token, sql):
    request = urllib.request.Request(
        API % ref,
        data=json.dumps({"query": sql}).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": "queryhub-setup/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def describe_failure(status, body):
    try:
        message = json.loads(body).get("message", body)
    except ValueError:
        message = body
    hints = {
        401: "The access token was rejected. Check it is complete and not expired.",
        403: "The token is not allowed to manage this project.",
        404: "Project not found. Check supabase.url in data/settings.json.",
    }
    hint = hints.get(status, "")
    return "HTTP %d: %s%s" % (status, str(message)[:600], ("\n  " + hint) if hint else "")


def main():
    files = [os.path.abspath(path) for path in sys.argv[1:]] or default_files()
    for path in files:
        if not os.path.exists(path):
            raise SystemExit("File not found: %s" % path)

    token = read_token()
    ref = read_project_ref()
    print("Project: %s" % ref)

    for path in files:
        name = os.path.relpath(path, ROOT)
        with open(path, encoding="utf-8") as handle:
            sql = handle.read()
        sys.stdout.write("Applying %s ... " % name)
        sys.stdout.flush()
        status, body = run_sql(ref, token, sql)
        if 200 <= status < 300:
            print("ok")
        else:
            print("FAILED")
            print("  " + describe_failure(status, body))
            raise SystemExit(1)

    print("Done. Reload the site.")


if __name__ == "__main__":
    main()
