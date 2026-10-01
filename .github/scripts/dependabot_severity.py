#!/usr/bin/env python3
"""Decide whether a Dependabot PR fixes a critical advisory (CVSS >= 9.0).

Companion to .github/dependabot.yml, which already limits Dependabot to
security updates. Reads the outputs of dependabot/fetch-metadata from the
environment and queries the public OSV API (https://osv.dev) -- the advisory
database that feeds GitHub's own Dependabot alerts -- to find which advisories
stop affecting the dependency at the version this PR updates to.

Environment variables (provided by the workflow):
    ECOSYSTEM     fetch-metadata ``package-ecosystem`` output, e.g. "uv", "npm"
    NAMES         fetch-metadata ``dependency-names`` output, e.g. "lodash"
    PREVIOUS      fetch-metadata ``previous-version`` output
    NEW           fetch-metadata ``new-version`` output
    GITHUB_OUTPUT optional; when set, ``verdict=...`` is appended
    COMMENT_FILE  optional; when set, the markdown comment is written there

Verdicts (printed to stdout as JSON):
    keep     at least one advisory fixed by the PR is CRITICAL
    close    every advisory fixed by the PR is below critical
    unknown  not enough information to decide; the PR is left open
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

OSV_QUERY_URL = "https://api.osv.dev/v1/query"
OSV_VULN_URL = "https://osv.dev/vulnerability/"

# Dependabot package-ecosystem -> OSV ecosystem (fetch-metadata reports the
# underscore form, e.g. "npm_and_yarn", "github_actions")
OSV_ECOSYSTEMS = {
    "uv": "PyPI",
    "pip": "PyPI",
    "npm": "npm",
    "npm_and_yarn": "npm",
    "github-actions": "GitHub Actions",
    "github_actions": "GitHub Actions",
}

SEVERITIES = ("CRITICAL", "HIGH", "MODERATE", "LOW")


def query_osv(ecosystem: str, name: str, version: str) -> list[dict]:
    """Return the advisories from OSV affecting ``name@version``."""
    payload = json.dumps({"package": {"name": name, "ecosystem": ecosystem}, "version": version}).encode()
    request = urllib.request.Request(  # noqa: S310  (fixed https URL)
        OSV_QUERY_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310  (fixed https URL)
        return json.load(response).get("vulns") or []


def severity(vuln: dict) -> str | None:
    """Return the GHSA severity category of a vuln, if OSV reports one."""
    database_severity = (vuln.get("database_specific") or {}).get("severity")
    if isinstance(database_severity, str) and database_severity.upper() in SEVERITIES:
        return database_severity.upper()
    for entry in vuln.get("severity") or []:
        score = (entry.get("score") or "").upper()
        if entry.get("type") == "ECOSYSTEM" and score in SEVERITIES:
            return score
    return None


def cves(vuln: dict) -> list[str]:
    return sorted(a for a in vuln.get("aliases") or [] if a.startswith("CVE-"))


def deduplicate(vulns: list[dict]) -> list[dict]:
    """Drop OSV duplicates (e.g. PYSEC + GHSA entries for the same CVE).

    Entries are keyed by their CVE aliases; when duplicates collide, prefer
    the entry that carries a severity rating.
    """
    by_key: dict[tuple, dict] = {}
    for vuln in vulns:
        key = tuple(cves(vuln)) or (vuln.get("id"),)
        current = by_key.get(key)
        if current is None or (severity(current) is None and severity(vuln) is not None):
            by_key[key] = vuln
    return list(by_key.values())


def advisory_link(vuln: dict) -> str:
    return f"[{vuln.get('id')}]({OSV_VULN_URL}{vuln.get('id')})"


def verdict_body(verdict: str, reason: str, vulns: list[dict]) -> str:
    if verdict == "unknown":
        return (
            "🤖 **Automated severity filter: severity could not be determined**\n\n"
            "Leaving this security update open for manual review.\n\n"
            f"Reason: {reason}\n"
        )

    rows = "\n".join(
        "| {} | {} | {} |".format(
            advisory_link(vuln),
            (severity(vuln) or "unknown").lower(),
            ", ".join(cves(vuln)) or "none",
        )
        for vuln in vulns
    )
    highest = next((s for s in SEVERITIES if any(severity(v) == s for v in vulns)), "unknown")
    return (
        f"🤖 **Automated severity filter**\n\n"
        f"Closing this security update: it fixes no advisory rated **critical** "
        f"(CVSS ≥ 9.0), the threshold configured for this repository "
        f"(see [`.github/dependabot.yml`](../blob/main/.github/dependabot.yml)). "
        f"Highest severity fixed by this PR: `{highest.lower()}`.\n\n"
        "Advisories fixed by this update:\n\n"
        "| Advisory | Severity | CVE |\n"
        "| --- | --- | --- |\n"
        f"{rows}\n\n"
        "To keep this update anyway, bump the dependency manually or reopen this "
        "PR with `@dependabot reopen` (the filter only runs when a PR is opened "
        "or updated, so a reopened PR will not be closed again).\n"
    )


def emit(verdict: str, reason: str, vulns: list[dict]) -> int:
    body = verdict_body(verdict, reason, vulns)
    sys.stdout.write(json.dumps({"verdict": verdict, "reason": reason}, indent=2) + "\n")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as handle:
            handle.write(f"verdict={verdict}\n")

    comment_file = os.environ.get("COMMENT_FILE")
    if comment_file:
        Path(comment_file).write_text(body, encoding="utf-8")
    return 0


def input_problem(ecosystem: str, names: list[str], previous: str, new: str) -> str | None:
    """Return a human-readable reason when the metadata cannot be evaluated."""
    if ecosystem not in OSV_ECOSYSTEMS:
        return (
            f"no OSV ecosystem mapping for `{ecosystem or 'unknown'}` "
            "(ecosystems without OSV advisory coverage, e.g. Docker, cannot be classified)"
        )
    if len(names) != 1 or not previous or not new:
        return (
            "expected exactly one dependency with both a previous and a new "
            f"version (got names={names!r}, previous={previous!r}, new={new!r})"
        )
    return None


def main() -> int:
    ecosystem = os.environ.get("ECOSYSTEM", "").strip()
    names = [name.strip() for name in os.environ.get("NAMES", "").split(",") if name.strip()]
    previous = os.environ.get("PREVIOUS", "").strip()
    new = os.environ.get("NEW", "").strip()

    problem = input_problem(ecosystem, names, previous, new)
    if problem:
        return emit("unknown", problem, [])

    name = names[0]
    try:
        old_vulns = query_osv(OSV_ECOSYSTEMS[ecosystem], name, previous)
        new_vulns = query_osv(OSV_ECOSYSTEMS[ecosystem], name, new)
    except Exception as exc:  # noqa: BLE001 - any lookup failure keeps the PR open
        return emit("unknown", f"OSV lookup for `{name}` failed: {exc}", [])

    new_ids = {vuln.get("id") for vuln in new_vulns}
    fixed = deduplicate([vuln for vuln in old_vulns if vuln.get("id") not in new_ids])

    if not fixed:
        if not old_vulns:
            reason = (
                f"OSV lists no advisories affecting `{name}@{previous}`, so the "
                "advisories fixed by this update cannot be verified"
            )
        else:
            reason = (
                f"OSV lists no advisories that stop affecting `{name}` between "
                f"{previous} and {new}, so this update does not match any known "
                "fixed vulnerability"
            )
        return emit("unknown", reason, [])

    if any(severity(vuln) == "CRITICAL" for vuln in fixed):
        return emit("keep", "fixes at least one critical advisory", fixed)
    if any(severity(vuln) is None for vuln in fixed):
        return emit("unknown", "at least one fixed advisory has no severity rating", fixed)
    return emit("close", "fixes only advisories below critical severity", fixed)


if __name__ == "__main__":
    sys.exit(main())
