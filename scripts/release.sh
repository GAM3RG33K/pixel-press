#!/usr/bin/env bash
#
# Interactive release wizard for pixel-press.
#
#   bun run release        (or: bash scripts/release.sh)
#
# Flow:
#   1. Pick the flavor — development (default) or production.
#   2. Shows the latest tag / GitHub release for that flavor, for reference.
#   3. Shows the next major / minor / patch versions based on that tag.
#   4. Lets you edit the final tag string, then asks for confirmation.
#   5. On confirmation, creates an annotated tag and pushes it. The tag push
#      is the only trigger the Release workflow needs: it builds the bundles
#      and creates a DRAFT (pre)release; nothing goes live until you publish
#      it from the Releases page.
#
# Flavors:
#   dev   v0.1.0-dev -> "pixel-press Dev" (com.pixelpress.app.dev), installs
#                      side-by-side with production, DRAFT PRERELEASE.
#   prod  v0.1.0     -> "pixel-press" (com.pixelpress.app), DRAFT release.
#
# Expect ~25–40 minutes from tag push to the draft: all four legs run in
# parallel inside the Release workflow.
#
# Dependencies: git, bash, coreutils only. No gh/3rd-party tooling —
# releases are tracked purely via git tags; see the GitHub Releases page
# for draft status.

set -euo pipefail

# ── colors ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  RESET=$'\033[0m'; BOLD=$'\033[1m'; DIM=$'\033[2m'
  GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; VIOLET=$'\033[35m'
else
  RESET=''; BOLD=''; DIM=''; GREEN=''; RED=''; YELLOW=''; CYAN=''; VIOLET=''
fi

err()  { printf '%s\n' "${RED}$*${RESET}" >&2; }
info() { printf '%s\n' "${DIM}$*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}$*${RESET}"; }
ok()   { printf '%s\n' "${GREEN}$*${RESET}"; }
hr()   { printf '%s\n' "${DIM}──────────────────────────────────────────────────────────────────${RESET}"; }
section() { printf '\n%s%s%s\n' "$VIOLET" "$*" "$RESET"; }

die() { err "$*"; exit 1; }

command -v git >/dev/null || die 'git is required.'
if [[ ! -t 0 ]]; then
  info 'stdin is not a terminal — reading scripted answers from the pipe.'
fi

# ── repo state ───────────────────────────────────────────────────────────────
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die 'Run this from inside the pixel-press repo.'
cd "$ROOT"
HEADSHA="$(git log --oneline -1)"
BRANCH="$(git branch --show-current)"
DIRTY="$(git status --porcelain)"

# ── semver helpers (release tags only: vX.Y.Z[-prerelease]) ─────────────────
# Parses a tag into S_MAJOR/S_MINOR/S_PATCH/S_PRE. Returns 1 for non-release tags.
parse_tag() {
  local tag="$1"
  [[ "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9A-Za-z.-]+))?$ ]] || return 1
  S_MAJOR="${BASH_REMATCH[1]}"; S_MINOR="${BASH_REMATCH[2]}"; S_PATCH="${BASH_REMATCH[3]}"
  S_PRE="${BASH_REMATCH[5]:-}"
  return 0
}

is_valid_tag() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]
}

# Normalize a user-typed tag to include the leading v. Sets NORMALIZED_TAG.
# Returns 1 when invalid.
normalize_tag() {
  local t="$1"
  [[ "$t" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || return 1
  [[ "$t" == v* ]] || t="v$t"
  NORMALIZED_TAG="$t"
  return 0
}

# Latest tag for a flavor ("dev" or "prod"); prints nothing if there is none.
# prod = plain vX.Y.Z ; dev = vX.Y.Z-dev[.N]
latest_tag() {
  local flavor="$1" tag key best_key='' best_tag='' devnum isdev
  while IFS= read -r tag; do
    parse_tag "$tag" || continue
    isdev=0; [[ "$S_PRE" == dev* ]] && isdev=1
    if [[ "$flavor" == 'dev'  && $isdev -eq 0 ]]; then continue; fi
    if [[ "$flavor" == 'prod' && -n "$S_PRE" ]]; then continue; fi
    devnum=0
    if [[ "$S_PRE" =~ ^dev\.([0-9]+)$ ]]; then devnum="${BASH_REMATCH[1]}"; fi
    key="$(printf '%010d%05d%05d%05d' "$S_MAJOR" "$S_MINOR" "$S_PATCH" "$devnum")"
    if [[ -z "$best_key" || "$key" > "$best_key" ]]; then best_key="$key"; best_tag="$tag"; fi
  done < <(git tag --list 'v*')
  printf '%s' "$best_tag"
}

tag_exists() {
  local tag="$1" remote
  if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null 2>&1; then
    return 0
  fi
  remote="$(git ls-remote --tags origin "$tag" 2>/dev/null || true)"
  [[ -n "$remote" ]]
}

bump_version() { # bump_version <major|minor|patch> <ma> <mi> <pa> — prints x.y.z
  case "$1" in
    major) printf '%d.0.0' $(( $2 + 1 )) ;;
    minor) printf '%d.%d.0' "$2" $(( $3 + 1 )) ;;
    patch) printf '%d.%d.%d' "$2" "$3" $(( $4 + 1 )) ;;
  esac
}

# Next free dev tag for a base X.Y.Z: prints vX.Y.Z-dev, else vX.Y.Z-dev.N
next_free_dev() {
  local base="$1" candidate n
  candidate="v${base}-dev"
  if ! tag_exists "$candidate"; then printf '%s' "$candidate"; return; fi
  for n in $(seq 1 99); do
    candidate="v${base}-dev.${n}"
    if ! tag_exists "$candidate"; then printf '%s' "$candidate"; return; fi
  done
  printf '%s' "$candidate"
}

# ── reference info ───────────────────────────────────────────────────────────
show_reference() { # flavor latest_tag
  local flavor="$1" latest="$2"
  if [[ -n "$latest" ]]; then
    info "latest git tag for this flavor:        ${GREEN}${latest}${RESET}"
  else
    info "latest git tag for this flavor:        ${YELLOW}(none yet — this will be the first ${flavor} release)${RESET}"
  fi
  info "latest GitHub release for this flavor:  check the Releases page (drafts do not appear in gh/git)"
}

# ── flavor menu (sets FLAVOR) ───────────────────────────────────────────────
ask_flavor() {
  printf '\nWhich flavor do you want to release?\n'
  printf '  %s1%s) development (dev)  — pixel-press Dev, side-by-side with prod, DRAFT PRERELEASE  %s[default]%s\n' "$BOLD" "$RESET" "$DIM" "$RESET"
  printf '  %s2%s) production (prod)  — pixel-press, DRAFT release\n' "$BOLD" "$RESET"
  local choice
  read -rp 'Select [1]: ' choice || choice=1
  case "$(printf '%s' "${choice:-1}" | tr '[:upper:]' '[:lower:]')" in
    1|dev|development) FLAVOR=dev  ;;
    2|prod|production) FLAVOR=prod ;;
    *) warn 'Unrecognized choice — defaulting to dev.'; FLAVOR=dev ;;
  esac
}

# ── version menu (sets CHOICE_TAG) ───────────────────────────────────────────
ask_bump() { # flavor base_tag
  local flavor="$1" base_tag="$2" suf=''
  parse_tag "$base_tag"
  [[ "$flavor" == 'dev' ]] && suf='-dev'

  SUGGEST_MAJOR="v$(bump_version major "$S_MAJOR" "$S_MINOR" "$S_PATCH")${suf}"
  SUGGEST_MINOR="v$(bump_version minor "$S_MAJOR" "$S_MINOR" "$S_PATCH")${suf}"
  SUGGEST_PATCH="v$(bump_version patch "$S_MAJOR" "$S_MINOR" "$S_PATCH")${suf}"

  if [[ "$flavor" == 'dev' ]]; then
    SUGGEST_MAJOR="$(next_free_dev "$(bump_version major "$S_MAJOR" "$S_MINOR" "$S_PATCH")")"
    SUGGEST_MINOR="$(next_free_dev "$(bump_version minor "$S_MAJOR" "$S_MINOR" "$S_PATCH")")"
    SUGGEST_PATCH="$(next_free_dev "$(bump_version patch "$S_MAJOR" "$S_MINOR" "$S_PATCH")")"
  fi

  printf '\nNext versions based on %s:\n' "${GREEN}${base_tag}${RESET}"
  printf '  %s1%s) major   %s\n' "$BOLD" "$RESET" "$SUGGEST_MAJOR"
  printf '  %s2%s) minor   %s\n' "$BOLD" "$RESET" "$SUGGEST_MINOR"
  printf '  %s3%s) patch   %s   %s[default]%s\n' "$BOLD" "$RESET" "$SUGGEST_PATCH" "$DIM" "$RESET"
  printf '  %s4%s) custom  — type any tag yourself (e.g. v0.3.0-dev)\n' "$BOLD" "$RESET"

  local choice
  read -rp 'Select [3]: ' choice || choice=3
  choice="$(printf '%s' "${choice:-3}" | tr '[:upper:]' '[:lower:]')"
  case "$choice" in
    1|major) CHOICE_TAG="$SUGGEST_MAJOR" ;;
    2|minor) CHOICE_TAG="$SUGGEST_MINOR" ;;
    3|patch|'') CHOICE_TAG="$SUGGEST_PATCH" ;;
    4|custom) ask_custom_tag ;;
    v*)
      if normalize_tag "$choice"; then
        CHOICE_TAG="$NORMALIZED_TAG"
      else
        warn 'That looks like a tag but is not valid semver — asking again.'
        ask_custom_tag
      fi ;;
    *) warn 'Unrecognized choice — defaulting to patch.'; CHOICE_TAG="$SUGGEST_PATCH" ;;
  esac
}

ask_custom_tag() {
  local raw
  while true; do
    read -rp 'Tag: ' raw || raw=''
    if normalize_tag "$raw"; then CHOICE_TAG="$NORMALIZED_TAG"; return; fi
    err 'Invalid tag. Expected vX.Y.Z with optional -prerelease, e.g. v1.2.3 or v1.2.3-dev'
  done
}

# ── main ─────────────────────────────────────────────────────────────────────
printf '%spixel-press release wizard%s  %s\n' "$BOLD" "$RESET" "$DIM(${ROOT})${RESET}"

section '── Release type ──────────────────────────────'
ask_flavor
FLAVOR="$FLAVOR"

section "── Latest ${FLAVOR} release for reference ──"
LATEST_FLAVOR="$(latest_tag "$FLAVOR")"
show_reference "$FLAVOR" "$LATEST_FLAVOR"

BASE_TAG="${LATEST_FLAVOR:-v0.0.0}"
if [[ -z "$LATEST_FLAVOR" ]]; then
  if [[ "$FLAVOR" == 'dev' ]]; then
    OTHER="$(latest_tag prod)"
  else
    OTHER="$(latest_tag dev)"
  fi
  if [[ -n "$OTHER" ]]; then
    info "no ${FLAVOR} tags yet — basing next version off latest other-flavor tag: ${OTHER}"
    BASE_TAG="$OTHER"
  fi
fi

section '── Version ───────────────────────────────────'
if [[ -n "$DIRTY" ]]; then
  warn 'Note: you have uncommitted changes. The tag will point at HEAD'
  warn "      (${HEADSHA}) — your changes are NOT in the release."
else
  info "Tag will point at HEAD (${HEADSHA}) on branch ${BRANCH}."
fi

ask_bump "$FLAVOR" "$BASE_TAG"
TAG="$CHOICE_TAG"

# ── final confirmation ───────────────────────────────────────────────────────
if tag_exists "$TAG"; then EXISTS=1; else EXISTS=0; fi
if [[ "$FLAVOR" == 'dev' ]]; then
  FLAVOR_BLURB='pixel-press Dev  (com.pixelpress.app.dev) — installs side-by-side with production'
  RELEASE_KIND='DRAFT PRERELEASE'
  RELEASE_NAME="pixel-press ${TAG} (Development)"
  PUBLISH_NOTE='draft + prerelease — review on the Releases page, then publish. Production "latest" is untouched.'
  WORKFLOW_ARGS='--config src-tauri/tauri.dev.conf.json'
else
  FLAVOR_BLURB='pixel-press  (com.pixelpress.app) — the production app users run'
  RELEASE_KIND='DRAFT release'
  RELEASE_NAME="pixel-press ${TAG}"
  PUBLISH_NOTE='draft — review on the Releases page, then publish. Nothing goes live until you do.'
  WORKFLOW_ARGS='(none)'
fi

section '── Summary ───────────────────────────────────'
printf '  %sflavor:%s    %s%s%s  →  %s\n'      "$DIM" "$RESET" "$BOLD" "$FLAVOR" "$RESET" "$FLAVOR_BLURB"
printf '  %stag:%s       %s%s%s\n'            "$DIM" "$RESET" "$GREEN" "$TAG" "$RESET"
[[ "$EXISTS" -eq 1 ]] && warn '  ⚠ tag already exists locally or on origin'
printf '  %spoints at:%s %s  (%s)\n'          "$DIM" "$RESET" "$HEADSHA" "$BRANCH"
printf '  %sworkflow:%s  Release (triggered by tag push) → builds 4 targets:\n' "$DIM" "$RESET"
printf '               macOS arm64 + Intel (.dmg), Linux x64/ARM64 (.AppImage, .deb)\n'
printf '               flavor args: %s\n'      "$WORKFLOW_ARGS"
printf '  %sresult:%s    %s "%s" with all bundles attached\n' "$DIM" "$RESET" "$RELEASE_KIND" "$RELEASE_NAME"
printf '  %sexpected:%s  ~25–40 minutes from tag push to the draft (all 5 legs run in parallel)\n' "$DIM" "$RESET"
printf '  %swatch:%s     GitHub → Releases → the Actions run for this tag\n' "$DIM" "$RESET"
printf '               or Releases page → your draft (once the run finishes)\n'
printf '  %spublish:%s   %s\n'                "$DIM" "$RESET" "$PUBLISH_NOTE"
hr

if [[ "$EXISTS" -eq 1 ]]; then
  read -rp "$(printf '%sTag already exists. Tag it anyway? [y/N]: %s' "$YELLOW" "$RESET")" CONFIRM || CONFIRM=n
  case "$(printf '%s' "${CONFIRM:-n}" | tr '[:upper:]' '[:lower:]')" in
    y|yes) ;;
    *) printf 'Aborted — nothing pushed.\n'; exit 0 ;;
  esac
fi

read -rp "$(printf '%sPush tag %s and trigger the Release workflow? [y/N]: %s' "$BOLD" "$TAG" "$RESET")" CONFIRM || CONFIRM=n
case "$(printf '%s' "${CONFIRM:-n}" | tr '[:upper:]' '[:lower:]')" in
  y|yes) ;;
  *) warn 'Aborted — nothing pushed.'; exit 0 ;;
esac

section '── Releasing ───────────────────────────────────'
git tag -a "$TAG" -m "$TAG"
ok "created annotated tag ${TAG}"
if git push origin "$TAG"; then
  ok "pushed ${TAG} to origin"
else
  err "push failed — the tag is still local. Delete it with: git tag -d ${TAG}"
  exit 1
fi

printf '\n%s%sRelease workflow triggered.%s\n' "$GREEN" "$BOLD" "$RESET"
printf 'What happens next:\n'
printf '  1. GitHub Actions runs %sRelease%s on tag %s — four legs in parallel (~25–40 min total).\n' "$BOLD" "$RESET" "$TAG"
if [[ "$FLAVOR" == 'dev' ]]; then
  printf '  2. %spixel-press Dev%s bundles are attached to a %sDRAFT PRERELEASE%s named "%s".\n' "$BOLD" "$RESET" "$BOLD" "$RESET" "$RELEASE_NAME"
  printf '     It installs as a separate app — your production install is not touched.\n'
else
  printf '  2. Production bundles are attached to a %sDRAFT release%s named "%s".\n' "$BOLD" "$RESET" "$RELEASE_NAME"
fi
printf '  3. It will NOT go live by itself. When the draft is ready:\n'
printf '       open the Releases page — your draft is listed there\n'
printf '     review the assets on the Releases page, then "Publish release".\n'
printf '     (publish with the "Publish release" button; production "latest" stays untouched until then)\n'
printf '  4. If a leg fails, the draft is not created — fix and re-tag\n'
printf '     (%sgit tag -d %s && git push origin :%s%s).\n' "$CYAN" "$TAG" "$TAG" "$RESET"
