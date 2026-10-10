# Portão da Fase 1 — roteiro de teste

**Critério:** 4 pessoas se encontram no lobby, entram juntas pelo portal e jogam o Nível 0 a 60 fps num
celular médio. Número de corte: **FPS médio ≥ 55 e "1% pior" ≥ 40** no lobby cheio e no Nível 0.

## Antes da sessão

1. Servidor: `pnpm build && pnpm exec wrangler dev --ip 0.0.0.0` (ou o preview publicado).
2. Carga do lobby (tem que dar `OK`): `pnpm load:lobby http://localhost:8787 24 600`
   - Referência local em 2026-10-10: 24 bots por 60 s → 9,8 snapshots/s por bot, p95 106 ms,
     maior intervalo 150 ms, 0 correções, 0 erros.
3. Aparelhos: 1 Android médio, 1 iPhone, 1 notebook com GPU integrada, mais 1 qualquer.

## Na sessão (repetir 3 vezes)

1. Todos abrem `/lobby/?stats` (ou apertam F3) e entram no mesmo lobby privado pelo código.
2. Andam, correm, pulam, usam os 3 emotes e o chat por 2 minutos. Um convida os outros para o grupo.
3. O primeiro a pisar no portal escolhe **4** no "Quantos no time?"; os outros entram; parte em 5 s.
4. No Nível 0: procurar os 3 fusíveis e sair. Pelo menos uma vez, alguém deve ser pego e revivido (V).
5. No fim, todos voltam sozinhos ao lobby.

## O que anotar por aparelho

| Aparelho | Lobby: FPS médio / 1% pior | Nível 0: FPS médio / 1% pior | Qualidade escolhida | Travadas, bugs, sensação |
| -------- | -------------------------- | ---------------------------- | ------------------- | ------------------------ |
|          |                            |                              |                     |                          |

Os números estão no painel (`?stats` ou F3), que mostra os últimos 10 s.

## Decisão

- Passou nos 3 rodadas, em todos os aparelhos → Fase 2.
- Não passou → anotar onde (lobby ou nível, qual aparelho) e otimizar antes de seguir.
