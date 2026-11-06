"""Back up QueryHub content to a JSON file, keeping the 3 newest good backups.

Usage (from the repo root):

    python setup/backup.py              # writes to backups/
    python setup/backup.py D:\\somewhere  # writes to another folder

Reads entries, votes, comments, and usernames through the public API, so no
token is needed. Accounts and PINs live in Supabase's private auth tables
and are not included.

A backup only counts once it has been written, read back, and matched
against what was fetched. Older backups are pruned only after that, and a
run that fails or finds the database empty deletes nothing.
"""

import datetime
import glob
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEEP = 3
PAGE = 1000
# table -> column(s) that give a stable order for paging
TABLES = {
    "profiles": "id",
    "queries": "id",
    "query_votes": "query_id,user_id",
    "query_comments": "id",
}


def load_config():
    with open(os.path.join(ROOT, "data", "settings.json"), encoding="utf-8") as handle:
        supabase = json.load(handle).get("supabase", {})
    if not supabase.get("url") or not supabase.get("anonKey"):
        raise SystemExit("data/settings.json has no supabase url / anonKey")
    return supabase["url"].rstrip("/"), supabase["anonKey"]


def fetch_table(url, key, table, order):
    rows = []
    while True:
        request = urllib.request.Request(
            "%s/rest/v1/%s?select=*&order=%s&limit=%d&offset=%d" % (url, table, order, PAGE, len(rows)),
            headers={"apikey": key, "Authorization": "Bearer " + key, "User-Agent": "queryhub-backup/1.0"},
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            page = json.load(response)
        rows.extend(page)
        if len(page) < PAGE:
            return rows


def counts_of(path):
    with open(path, encoding="utf-8") as handle:
        return {name: len(rows) for name, rows in json.load(handle)["tables"].items()}


def main():
    if len(sys.argv) > 1 and sys.argv[1].startswith("-"):
        print(__doc__)
        return
    out_dir = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "backups")
    os.makedirs(out_dir, exist_ok=True)
    existing = sorted(glob.glob(os.path.join(out_dir, "queryhub-*.json")))

    url, key = load_config()
    try:
        tables = {name: fetch_table(url, key, name, order) for name, order in TABLES.items()}
    except (urllib.error.URLError, ValueError) as error:
        raise SystemExit("Backup failed, nothing written or deleted: %s" % error)
    counts = {name: len(rows) for name, rows in tables.items()}

    if counts["queries"] == 0 and existing and counts_of(existing[-1])["queries"] > 0:
        raise SystemExit(
            "The database returned no entries, but the last backup has some.\n"
            "Nothing was written or deleted. Check the site before backing up again."
        )

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    path = os.path.join(out_dir, "queryhub-%s.json" % stamp)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump({"created": stamp, "project": url, "counts": counts, "tables": tables}, handle, indent=1)

    # Known-good check: the file on disk must parse and match what was fetched.
    try:
        verified = counts_of(path) == counts
    except (OSError, ValueError, KeyError):
        verified = False
    if not verified:
        os.remove(path)
        raise SystemExit("Backup file failed verification and was removed. Older backups were kept.")

    for old in sorted(glob.glob(os.path.join(out_dir, "queryhub-*.json")))[:-KEEP]:
        os.remove(old)

    kept = sorted(glob.glob(os.path.join(out_dir, "queryhub-*.json")))
    print("Backup verified: %s" % path)
    print("  " + ", ".join("%s %d" % (name, n) for name, n in counts.items()))
    print("  keeping %d backup(s): %s" % (len(kept), ", ".join(os.path.basename(p) for p in kept)))


if __name__ == "__main__":
    main()
