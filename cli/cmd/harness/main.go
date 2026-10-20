// Command harness é o CLI do Smart Harness.
package main

import (
	"fmt"
	"io"
	"os"
)

// version e commit são definidos no build com -ldflags "-X main.version=... -X main.commit=...".
var (
	version = "dev"
	commit  = "unknown"
)

const usage = "uso: harness version"

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// run executa o comando pedido e devolve o código de saída.
// Sem argumento ou com comando desconhecido, imprime o uso em stderr e devolve 2.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 1 && args[0] == "version" {
		fmt.Fprintf(stdout, "harness %s (commit %s)\n", version, commit)
		return 0
	}
	fmt.Fprintln(stderr, usage)
	return 2
}
