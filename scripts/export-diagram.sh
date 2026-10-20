#!/bin/sh
# Exporta docs/arch/propose.excalidraw para docs/arch/propose.svg.
#
# O Excalidraw não tem exportador oficial de linha de comando: a exportação para SVG
# precisa de um navegador. Este script explica o passo manual e sai com erro,
# para não deixar um SVG desatualizado passar como gerado.
set -eu

src="docs/arch/propose.excalidraw"
out="docs/arch/propose.svg"

if [ ! -f "$src" ]; then
  echo "diagram: $src não encontrado" >&2
  exit 1
fi

cat >&2 <<EOF
diagram: exportação automática indisponível.
Passo manual:
  1. Abra https://excalidraw.com e use Open para carregar $src.
  2. Use Export image > SVG, com "Embed scene" ligado.
  3. Salve o arquivo como $out e faça commit dos dois arquivos.
EOF
exit 1
