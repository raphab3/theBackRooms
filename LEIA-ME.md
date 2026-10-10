# Backrooms — jogo completo

Cópia da versão 60: 14 fases, final Backrooms Glitch (1 → 5 → 3 fusíveis), modo construtor com mapas salvos, músicas, mapa no modo Normal e Hardcore sem mapa.

## Jogar no computador

1. Instale o Node.js 24: https://nodejs.org/
2. Extraia este ZIP.
3. Dentro da pasta extraída, execute `node scripts/local-server.mjs`.
4. Abra http://localhost:3000 no navegador. Deixe o terminal aberto enquanto joga.

No Windows, você também pode abrir `INICIAR-WINDOWS.bat` depois de instalar o Node.js.
No Linux/macOS, abra um terminal na pasta e rode `sh INICIAR.sh`.

Não é necessário instalar dependências para jogar. Abrir `index.html` diretamente não funciona: o jogo usa servidor para nomes, missões, chat e salas.

## Multiplayer no mesmo Wi-Fi

Inicie o servidor em um computador. Ele mostrará um endereço como `http://192.168.1.10:3000`.
Abra esse endereço nos outros dispositivos conectados à mesma rede. Um jogador cria a sala e os demais entram com o código. Libere a porta 3000 na rede privada se o firewall solicitar.

No celular, gire o aparelho manualmente se a tela cheia ou a rotação automática não estiverem disponíveis.

Esta cópia tem seu próprio chat, ranking, mapas do construtor e progresso. Seus dados e mapas do site não vêm no ZIP. Ela não se conecta às salas do site publicado. Depois de instalar Node.js e baixar o ZIP, você pode jogar sem internet; multiplayer entre aparelhos exige a rede local.

## Dados e controles

Os dados locais ficam em `data/game.sqlite`, criado ao iniciar. Para fazer backup, pare o servidor e copie a pasta `data`.
WASD: mover; mouse: olhar; Shift: correr; F: lanterna; V: reviver; Esc: pausa; T: chat; M: mostrar/esconder mapa no Normal. No celular, use o joystick e arraste para olhar. Controles Xbox/PlayStation também são suportados.

Nome especial: `lucca416453416453admin`. Ele libera mapas e moedas infinitas. O acesso é pelo nome, sem senha; qualquer pessoa que usar esse nome recebe os poderes. Partidas com vantagens admin não entram no ranking.

## Código-fonte

`public/`: jogo, músicas e interface (HTML/CSS/JS puro, sem build).
`worker/`: API em módulos — `index.js` (entrada), `api.js` (rotas), `rooms.js` (salas e partida), `players.js`, `chat.js`, `profiles.js`, `leaderboard.js`, `maps.js` (construtor) e `http.js` (respostas e erros).
`drizzle/`: migrações do banco (SQLite/D1).
`scripts/local-server.mjs`: servidor portátil usando SQLite do Node.js.
`tests/`: testes do jogo.

## Desenvolvimento

Gerenciador de pacotes: pnpm. Rode `pnpm install` uma vez (só ferramentas de desenvolvimento; o jogo não tem dependências).

| Comando                     | O que faz                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm start`                | Servidor local com Node (`data/game.sqlite`), porta 3000                                                                  |
| `pnpm dev`                  | Mesmo jogo no runtime da Cloudflare (Wrangler + D1 local), porta 8787. Rode `pnpm db:migrate:local` antes da primeira vez |
| `pnpm test`                 | Testes                                                                                                                    |
| `pnpm lint` / `pnpm format` | ESLint / Prettier                                                                                                         |
| `pnpm check`                | Formatação + lint + testes                                                                                                |
| `pnpm release`              | Aplica migrações no D1 remoto e publica o Worker                                                                          |

### Publicar na Cloudflare

1. `pnpm exec wrangler login`
2. `pnpm exec wrangler d1 create backrooms` e copie o `database_id` para `wrangler.jsonc`.
3. `pnpm release`

Versão do código publicado: ab1fc3a7405e813d39199afb1bb6ba87a8616cda.
Referência técnica do iniciador: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
