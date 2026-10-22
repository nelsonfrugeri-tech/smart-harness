#!/bin/sh
# The API replaces these placeholders with validated, POSIX-quoted literals.
set -eu
api_url=@@API_URL_SHELL@@
version=@@VERSION_SHELL@@

fail() { printf '%s\n' "harness: $*" >&2; exit 1; }
# The token is entered by the CLI through /dev/tty, never passed to installers.
unset SMART_HARNESS_TOKEN ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY
command -v curl >/dev/null 2>&1 || fail 'curl is required'
command -v claude >/dev/null 2>&1 || fail 'Claude Code is required; install it, then rerun this command'
case $(uname -s) in Darwin) os=darwin ;; Linux) os=linux ;; *) fail 'supported systems: macOS and Linux' ;; esac
case $(uname -m) in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) fail 'supported architectures: arm64 and amd64' ;; esac
asset="harness-${version}-${os}-${arch}"
work=$(mktemp -d) || fail 'cannot create temporary directory'
staged=
trap 'rm -rf "$work"; if [ -n "$staged" ]; then rm -f "$staged"; fi' EXIT HUP INT TERM
curl -fsS --connect-timeout 10 --max-time 120 "$api_url/install/$asset" -o "$work/$asset"
curl -fsS --connect-timeout 10 --max-time 120 "$api_url/install/SHA256SUMS" -o "$work/SHA256SUMS"
expected=$(awk -v name="$asset" '$2 == name { count++; hash=$1 } END { if (count != 1) exit 1; print hash }' "$work/SHA256SUMS") || fail 'checksum entry is missing or duplicated'
case "$expected" in *[!0-9a-fA-F]*|'') fail 'invalid SHA256 checksum' ;; esac
[ ${#expected} -eq 64 ] || fail 'invalid SHA256 checksum length'
if command -v sha256sum >/dev/null 2>&1; then
 actual=$(sha256sum "$work/$asset" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
 actual=$(shasum -a 256 "$work/$asset" | awk '{print $1}')
else
 fail 'sha256sum or shasum is required'
fi
[ "$actual" = "$expected" ] || fail 'SHA256 verification failed; existing installation was not changed'

install_dir=${HARNESS_INSTALL_DIR:-}
if [ -z "$install_dir" ]; then
 old_ifs=$IFS; IFS=:
 for candidate in $PATH; do
  case "$candidate" in "$HOME"/*) if [ -d "$candidate" ] && [ -w "$candidate" ]; then install_dir=$candidate; break; fi ;; esac
 done
 IFS=$old_ifs
fi
install_dir=${install_dir:-"$HOME/.local/bin"}
case "$install_dir" in /*) ;; *) fail 'HARNESS_INSTALL_DIR must be absolute' ;; esac
case "$install_dir" in *'
'*|*:*) fail 'installation directory cannot contain a newline or colon' ;; esac
mkdir -p "$install_dir"
[ -w "$install_dir" ] || fail 'installation directory is not writable; set HARNESS_INSTALL_DIR to a user-writable directory'
install_dir=$(cd "$install_dir" && pwd -P)
staged=$(mktemp "$install_dir/.harness.XXXXXX")
cp "$work/$asset" "$staged"
chmod 755 "$staged"
mv -f "$staged" "$install_dir/harness"
staged=

case ":$PATH:" in *":$install_dir:"*) ;; *)
 # Append one exact line without rewriting the user's existing shell configuration.
 quoted_dir=$(printf '%s' "$install_dir" | sed "s/'/'\\\\''/g")
 path_line="export PATH='$quoted_dir':\"\$PATH\""
 case "${SHELL:-}" in
  */zsh) profile="$HOME/.zshrc" ;;
  */bash) if [ "$os" = darwin ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi ;;
  *) profile="$HOME/.profile" ;;
 esac
 if [ ! -f "$profile" ] || ! grep -Fqx "$path_line" "$profile"; then
  printf '\n%s\n' "$path_line" >> "$profile"
 fi
 printf 'PATH configured in %s; open a new terminal after setup.\n' "$profile"
 esac
printf 'Installed %s at %s/harness\n' "$version" "$install_dir"
# Invoke the final executable so HARNESS_CLI_BIN never points to a temporary file.
"$install_dir/harness" login --api-url "$api_url"
printf '%s\n' 'Ready. In your repository, run: claude --model openrouter/free'
