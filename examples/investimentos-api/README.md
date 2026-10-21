# investimentos-api

API pequena em Go para posições e ordens de uma carteira de investimentos. É o projeto de referência que o agente do Smart Harness usa como alvo: código, ADRs, backlog e entregas ficam em [`docs/`](docs/).

## Requisitos

- Go 1.27
- Docker com Compose
- make

Nenhuma credencial real da AWS é usada. Com DynamoDB Local, o cliente usa as credenciais fictícias `local`.

**Dependência externa:** só o AWS SDK for Go v2, para falar com o DynamoDB. O roteamento usa a stdlib (ADR-0002).

## Como rodar

```bash
make up migrate run
```

- `up` sobe o DynamoDB Local deste diretório (`compose.yaml`) em `127.0.0.1:8100`. A porta 8100 evita colisão com um DynamoDB Local já rodando na porta padrão 8000. Troque com `DYNAMODB_PORT=8200 make up migrate run`.
- `migrate` cria a tabela `investimentos` e a carteira `p-1` com duas posições. Rodar de novo não duplica nada.
- `run` serve a API em `127.0.0.1:8090` (`ADDR` muda o endereço).
- `down` para só o DynamoDB Local deste exemplo. Os dados ficam em memória e somem.

## Rotas

```bash
curl -s http://127.0.0.1:8090/v1/portfolios/p-1/positions
curl -s -i -X POST http://127.0.0.1:8090/v1/portfolios/p-1/orders -H 'Content-Type: application/json' -d '{"symbol":"PETR4","side":"buy","quantity":10,"price_cents":3850}'
curl -s http://127.0.0.1:8090/v1/orders/<orderId>
```

Use no terceiro comando o `orderId` do header `Location` do `POST`. Dinheiro sempre em centavos inteiros. Erros seguem `application/problem+json` (ADR-0003).

## Testes

```bash
make test
make test-integration
```

- `test`: testes unitários, sem Docker.
- `test-integration`: testes com a build tag `integration` contra o DynamoDB Local (precisa de `make up`). Cada teste cria e apaga a própria tabela; a tabela `investimentos` não é tocada.
