#!/usr/bin/env bash
set -euo pipefail

server_address="35.175.182.242"
ec2_user="ubuntu"
ssh_port="22"
remote_path="/opt/5d"
key_path_posix="/c/Users/Atos/.ssh/orion.ppk"
dry_run=false

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
  shift
fi

(( $# == 0 )) || {
  printf 'Uso: %s [--dry-run]\n' "${0##*/}" >&2
  exit 2
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf 'Erro: %s\n' "$1" >&2
  exit 1
}

find_putty_tool() {
  local tool_name="$1"
  local tool_path=""

  if tool_path="$(command -v "$tool_name" 2>/dev/null)"; then
    printf '%s\n' "$tool_path"
    return 0
  fi

  local candidates=(
    "/c/Program Files/PuTTY/$tool_name"
    "/c/Program Files (x86)/PuTTY/$tool_name"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

command -v cygpath >/dev/null 2>&1 || fail "Este script deve ser executado no Git Bash."

# Inclui apenas arquivos e pastas visíveis. Arquivos iniciados por ponto não
# entram no glob, e node_modules é removido explicitamente da lista.
shopt -s nullglob
all_visible_entries=("$script_dir"/*)
shopt -u nullglob

source_entries=()
for entry in "${all_visible_entries[@]}"; do
  [[ "${entry##*/}" == "node_modules" ]] && continue
  source_entries+=("$entry")
done

(( ${#source_entries[@]} > 0 )) || fail "Nenhum arquivo encontrado em $script_dir"

source_entries_windows=()
for entry in "${source_entries[@]}"; do
  source_entries_windows+=("$(cygpath -w "$entry")")
done

printf 'Origem: %s\n' "$script_dir"
printf 'Destino: %s@%s:%s\n' "$ec2_user" "$server_address" "$remote_path"
printf 'Arquivos e pastas encontrados: %d\n' "${#source_entries[@]}"

if [[ "$dry_run" == true ]]; then
  printf '\nItens que serão copiados:\n'
  for entry in "${source_entries[@]}"; do
    printf '  - %s\n' "${entry##*/}"
  done
  printf '\nValidação concluída. Nenhuma conexão foi realizada.\n'
  exit 0
fi

[[ -f "$key_path_posix" ]] || fail "Chave não encontrada: $key_path_posix"
plink="$(find_putty_tool "plink.exe")" || fail "plink.exe não encontrado. Instale o PuTTY."
pscp="$(find_putty_tool "pscp.exe")" || fail "pscp.exe não encontrado. Instale o PuTTY."
key_path_windows="$(cygpath -w "$key_path_posix")"

printf '\nNo primeiro acesso, confirme a assinatura SSH exibida pelo PuTTY.\n'

# Desativa a conversão automática de argumentos do Git Bash. Os caminhos
# locais já foram convertidos acima, e os caminhos Linux devem permanecer /opt/5d.
MSYS2_ARG_CONV_EXCL='*' "$plink" \
  -ssh -P "$ssh_port" -i "$key_path_windows" \
  -l "$ec2_user" "$server_address" \
  "printf 'Conexão SSH estabelecida.\\n'"

printf '\nPreparando a pasta remota...\n'
MSYS2_ARG_CONV_EXCL='*' "$plink" \
  -batch -ssh -P "$ssh_port" -i "$key_path_windows" \
  -l "$ec2_user" "$server_address" \
  "sudo install -d -o '$ec2_user' -g '$ec2_user' '$remote_path' && sudo chown -R '$ec2_user:$ec2_user' '$remote_path'"

printf 'Copiando todos os arquivos...\n'
MSYS2_ARG_CONV_EXCL='*' "$pscp" \
  -batch -r -P "$ssh_port" -i "$key_path_windows" \
  "${source_entries_windows[@]}" \
  "${ec2_user}@${server_address}:${remote_path}/"

printf '\nDeploy concluído: %s@%s:%s\n' "$ec2_user" "$server_address" "$remote_path"
