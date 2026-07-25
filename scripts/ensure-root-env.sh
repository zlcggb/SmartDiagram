#!/usr/bin/env bash
# Ensure root .env exists and contains keys from .env.example (never overwrite existing values).

ensure_root_env() {
  local root_dir="${1:?root dir required}"
  local env_file="$root_dir/.env"
  local example_file="$root_dir/.env.example"
  local key value line

  if [ ! -f "$example_file" ]; then
    echo "缺少 $example_file" >&2
    return 1
  fi

  if [ ! -f "$env_file" ]; then
    cp "$example_file" "$env_file"
    echo "created"
    return 0
  fi

  local appended=0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -n "$key" ] || continue
    # Skip if key already present (commented or not) as KEY=
    if grep -Eq "^[[:space:]]*${key}=" "$env_file"; then
      continue
    fi
    if [ "$appended" -eq 0 ]; then
      printf '\n# --- appended missing keys from .env.example (%s) ---\n' "$(date +%Y-%m-%d)" >>"$env_file"
      appended=1
    fi
    printf '%s\n' "$line" >>"$env_file"
  done <"$example_file"

  if [ "$appended" -eq 1 ]; then
    echo "appended"
  else
    echo "ok"
  fi
}
