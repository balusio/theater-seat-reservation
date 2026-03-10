#!/bin/bash
# =============================================================================
# DEV.SH - Development Environment Launcher
# =============================================================================
# Carga variables de entorno desde .env y ejecuta mprocs.
#
# Uso:
#   ./dev.sh              # Inicia mprocs con todas las variables de .env
#   ./dev.sh -h           # Muestra ayuda
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

show_help() {
    echo "Usage: ./dev.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -c, --check    Check if .env exists and show loaded variables count"
    echo ""
    echo "This script loads environment variables from .env and starts mprocs."
}

check_env() {
    if [[ -f "$ENV_FILE" ]]; then
        local count=$(grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep '=' | wc -l | tr -d ' ')
        echo -e "${GREEN}✓${NC} .env found with ${count} variables"
    fi
}

case "$1" in
    -h|--help)
        show_help
        exit 0
        ;;
    -c|--check)
        check_env
        exit 0
        ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
    echo -e "${YELLOW}⚠${NC}  Warning: .env not found at ${ENV_FILE}"
    echo "    Copy .env.example to .env:"
    echo "    cp .env.example .env"
    echo ""
fi

if [[ -f "$ENV_FILE" ]]; then
    echo -e "${GREEN}📦${NC} Loading environment from .env..."
    set -a
    source <(grep -v '^#' "$ENV_FILE" | grep -v '^$' | grep '=')
    set +a
    echo -e "${GREEN}✓${NC}  Environment loaded"
    echo ""
fi

if ! command -v mprocs &> /dev/null; then
    echo -e "${RED}✗${NC} mprocs is not installed"
    echo ""
    echo "Install with:"
    echo "  brew install mprocs"
    echo ""
    exit 1
fi

echo -e "${GREEN}🚀${NC} Starting mprocs..."
echo ""
exec mprocs --config "${SCRIPT_DIR}/mprocs.yaml" "$@"
