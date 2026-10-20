# cli

CLI `harness` em Go. Hoje expõe só `harness version`; o engine de pacotes entra nas próximas issues.

Usa apenas a biblioteca padrão. O único `go.mod` do repositório fica aqui, então os comandos Go rodam com `go -C cli`.

```bash
go -C cli test ./...
go -C cli build -ldflags "-X main.version=0.1.0 -X main.commit=$(git rev-parse --short HEAD)" -o bin/harness ./cmd/harness
cli/bin/harness version   # harness 0.1.0 (commit abc1234)
```

Sem argumento ou com comando desconhecido, imprime o uso em stderr e sai com código 2.

A imagem da API (`control-plane/Dockerfile`) compila este binário e o instala em `/usr/local/bin/harness`.
