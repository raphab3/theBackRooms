# Plano — Backrooms: do labirinto ao jogo de sobrevivência cooperativo

Documento de visão completo (história, gameplay, Braço-Arma, arquitetura):
https://claude.ai/code/artifact/d9d06fd0-390a-4f1e-b250-81098bb7bd21

As specs de cada fase estão no specgate, workspace **TheBackRooms** (`proj-e38fn1c`).

## Objetivo

Transformar o Backrooms v60 (14 fases em sequência, raycaster 2D, multiplayer por polling) num
**jogo cooperativo de sobrevivência por expedições**:

- o time se prepara no **Posto Zero** (lobby), decide quando descer e volta com recursos;
- cada jogador evolui o seu **Braço-Arma** (Fogo, Gelo, Espinho, Raio, Pulso) e monta uma build RPG;
- missões paralelas destravam com o progresso; rank por profundidade, badges e temporadas.

## Princípios

1. **O jogo atual continua no ar** até a versão nova ser melhor que ele. Nada de reescrever tudo de uma vez.
2. **Cada fase termina num portão** testado com jogadores reais. Se o portão não passar, a próxima fase espera.
3. **Sem modelagem 3D manual.** Cenários e efeitos saem de código; personagens, props e texturas vêm de
   pacotes CC0 (Kenney, Quaternius, KayKit, ambientCG, Poly Haven) e animações do Mixamo. IA de 3D só para
   entidades únicas.
4. **Tudo na Cloudflare:** Workers, Durable Objects, D1 e R2.
5. **`world.js` continua sendo a fonte do labirinto**, compartilhado entre cliente e servidor.

## Fases

| Fase | Nome                     | Entrega                                                                                                                               | Portão para seguir                                                        |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0    | Fundação                 | Admin fora do jogo, multiplayer por WebSocket em Durable Object, contas, monorepo                                                     | 4 jogadores em salas reais sem travadas perceptíveis                      |
| 1    | Lobby 3D + Portal        | Cliente Three.js, boneco animado, lobby público (shards de 24) e privado por código, portal de 4 lugares estilo Roblox, Nível 0 em 3D | 4 pessoas entram juntas pelo portal e jogam o Nível 0 a 60 fps no celular |
| 2    | Expedições com progresso | Portais por nível, Braço de Fogo, recursos, extração, inventário salvo, bancada, armeiro                                              | Testers voltam a jogar por conta própria                                  |
| 3    | Conteúdo e liga          | Gelo, Espinho, Raio, Pulso, módulos, badges, missões, rank, temporadas, noites de defesa, atos da história                            | — (operação contínua)                                                     |

Ordem obrigatória: **0 → 1 → 2 → 3**. Dentro de cada fase, as tarefas podem rodar em paralelo quando
não dependem uma da outra (ver cada spec).

## Arquitetura alvo (resumo)

```
Navegador:  Portal (HTML leve)   Cliente 3D (Three.js)   Painel Admin (app separado)
                 │ HTTPS               │ WebSocket               │ HTTPS + Cloudflare Access
                 └──────────────► Worker de entrada (roteador) ◄─┘
                                       │
              ┌────────────────────────┼─────────────────────────┐
         DO Posto Zero            DO Expedição                R2 (assets glTF,
         (1 por time)          (1 por partida, 20 ticks/s)     texturas, áudio)
              └────────► D1 (contas, inventário, braços, badges, missões, rank)
```

Monorepo alvo (pnpm workspaces):

```
apps/game        cliente 3D (Vite + TypeScript + Three.js)
apps/admin       painel admin (Vite, protegido por Cloudflare Access)
apps/portal      site leve: login, perfil, rank
packages/shared  world.js, tipos e protocolo de rede compartilhados
worker           Worker de entrada + Durable Objects
```

## Decisões em aberto (precisam de resposta antes da fase indicada)

| Decisão                                                        | Recomendação                                                            | Bloqueia                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------- |
| Login: e-mail/Google ou só apelido?                            | Google + link mágico por e-mail; apelido continua como nome de exibição | Fase 0 (tarefa de contas) |
| Servidor local `pnpm start` (LAN, offline) continua existindo? | Sim, só para a versão 60; a versão nova usa `wrangler dev`              | Fase 0                    |
| Estilo visual                                                  | Low-poly em blocos (estilo Roblox), atmosfera liminal                   | Fase 1                    |
| Câmera                                                         | 1ª pessoa com braço visível; 3ª pessoa no lobby                         | Fase 1                    |
| Tamanho do time                                                | 4 na Fase 1; avaliar 6 na Fase 2                                        | Fase 2                    |
| Hardcore: morrer perde o braço equipado?                       | Não; perde a mochila e o nível do braço cai 1                           | Fase 3                    |
| Monetização                                                    | Só cosméticos, ou nenhuma                                               | Fase 3                    |
| Jogadores da v60 mantêm moedas e rank?                         | Mantêm moedas; rank v60 vira "Hall da Fama"                             | Fase 2                    |

## Riscos

| Risco                                                     | Mitigação                                                                                 |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Salto para 3D maior que o previsto                        | Fase 1 é um protótipo pequeno com portão de desempenho antes de qualquer conteúdo         |
| Assets de fontes diferentes com estilos que não combinam  | Escolher 1 pacote base de personagem e 1 de texturas; paleta e pós-processamento unificam |
| Custo de Durable Objects                                  | Hibernação de WebSocket; DO de expedição só existe enquanto a partida roda                |
| Celulares fracos                                          | Presets de qualidade automáticos; resolução dinâmica                                      |
| Trabalho paralelo com outras sessões no mesmo repositório | Cada fase em branch própria; trabalho grande em worktree                                  |
