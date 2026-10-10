# Portão da Fase 0 — telemetria e teste de carga

## Telemetria (Workers Analytics Engine)

Binding `TELEMETRY` (dataset `backrooms_telemetry`, em `wrangler.jsonc`). Helper: `worker/telemetry.js`.
Cada ponto: `index1` = código da sala, `blob1` = evento, `double1` = valor.

| evento         | valor                          | onde chamar                                                    |
| -------------- | ------------------------------ | -------------------------------------------------------------- |
| `rtt`          | RTT em ms (blob2 = id jogador) | no DO, ao receber o RTT medido pelo cliente: `recordRtt`       |
| `tick`         | duração do tick do DO (ms)     | no DO, `timeTick(env, code, () => this.tick())` no setInterval |
| `players`      | jogadores conectados           | no DO, em `upgrade` e `afterDisconnect`: `recordPlayers`       |
| `socket_error` | 1 (blob2 = motivo)             | no DO, em `webSocketError` e falhas de mensagem                |

Observação: dentro de um Worker o relógio só avança em I/O; o tick (CPU puro) tende a aparecer como 0 ms.
Para o aceite "tick p99 < 5 ms", confirme também pelo `wrangler tail`/métricas de CPU time do DO.

Consultas (SQL API do Analytics Engine):

```sql
-- RTT p95 por hora
SELECT quantileWeighted(0.95)(double1, _sample_interval) AS p95
FROM backrooms_telemetry WHERE blob1 = 'rtt' AND timestamp > NOW() - INTERVAL '1' HOUR;
-- tick p99
SELECT quantileWeighted(0.99)(double1, _sample_interval) AS p99
FROM backrooms_telemetry WHERE blob1 = 'tick' AND timestamp > NOW() - INTERVAL '1' HOUR;
-- erros de socket
SELECT blob2, SUM(_sample_interval) FROM backrooms_telemetry WHERE blob1 = 'socket_error' GROUP BY blob2;
```

## Teste de carga

```sh
node tests/load.mjs https://<preview>.workers.dev --rooms 10 --bots 4 --minutes 10
```

Sai com 0 se RTT p95 < 100 ms e sem erros de socket. Requer o endpoint `GET /api/rooms/:code/ws` (F0-T03).

## Sessão com 4 pessoas (celular + PC) — checklist de sensação

Marque com o dono do projeto (aceite final):

- [ ] Movimento próprio responde na hora (sem atraso perceptível)
- [ ] Os outros jogadores se movem de forma fluida (sem teletransporte/trancos)
- [ ] Nenhuma travada ao entrar/sair jogador
- [ ] Inimigo e itens consistentes entre todos os telas
- [ ] Celular e PC no mesmo nível de fluidez, por 10+ min
- [ ] Sem desconexões; reconexão ok se alternar Wi-Fi/4G
- [ ] Dono do projeto aprova: "4 jogadores sem travadas perceptíveis"
