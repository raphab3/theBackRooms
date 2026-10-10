// Local translations: no redirects, network requests or changes to player data.
const rows = `
⚒ MODO CONSTRUTOR|⚒ BUILDER MODE|⚒ MODO CONSTRUCTOR
MAPAS DA COMUNIDADE|COMMUNITY MAPS|MAPAS DE LA COMUNIDAD
Seu labirinto. Suas regras.|Your maze. Your rules.|Tu laberinto. Tus reglas.
MEUS MAPAS|MY MAPS|MIS MAPAS
GALERIA PÚBLICA|PUBLIC GALLERY|GALERÍA PÚBLICA
RECUPERAR RASCUNHO|RECOVER DRAFT|RECUPERAR BORRADOR
+ CRIAR MAPA|+ CREATE MAP|+ CREAR MAPA
FERRAMENTAS · B|TOOLS · B|HERRAMIENTAS · B
SALVAR|SAVE|GUARDAR
TESTAR|TEST|PROBAR
PUBLICAR|PUBLISH|PUBLICAR
SAIR|EXIT|SALIR
COLOCAR · E|PLACE · E|COLOCAR · E
APAGAR · Q|REMOVE · Q|BORRAR · Q
Caixa de ferramentas|Toolbox|Caja de herramientas
CONSTRUIR|BUILD|CONSTRUIR
Nome do mapa|Map name|Nombre del mapa
Tema das texturas|Texture theme|Tema de texturas
Cor da ferramenta|Tool color|Color de la herramienta
GIRAR OBJETO · R|ROTATE OBJECT · R|GIRAR OBJETO · R
Aparência e dificuldade|Appearance and difficulty|Aspecto y dificultad
Paredes|Walls|Paredes
Piso|Floor|Suelo
Teto|Ceiling|Techo
USAR CORES DO TEMA|USE THEME COLORS|USAR COLORES DEL TEMA
Iluminação|Lighting|Iluminación
Velocidade dos monstros|Monster speed|Velocidad de los monstruos
Parede|Wall|Pared
Apagar|Remove|Borrar
Pintar piso|Paint floor|Pintar suelo
Pintar parede|Paint wall|Pintar pared
Mesa|Table|Mesa
Cadeira|Chair|Silla
Caixa|Crate|Caja
Pilar|Column|Pilar
Mureta|Low wall|Muro bajo
Luz|Light|Luz
Início|Spawn|Inicio
Saída|Exit|Salida
Fusível|Fuse|Fusible
Moeda|Coin|Moneda
Monstro|Monster|Monstruo
VOLTAR AO CONSTRUTOR|BACK TO BUILDER|VOLVER AL CONSTRUCTOR
VOLTAR À GALERIA|BACK TO GALLERY|VOLVER A LA GALERÍA
CARREGAR MAIS|LOAD MORE|CARGAR MÁS
EDITAR|EDIT|EDITAR
RETIRAR DA GALERIA|UNPUBLISH|RETIRAR DE LA GALERÍA
EXCLUIR|DELETE|ELIMINAR
JOGAR|PLAY|JUGAR
Carregando mapas…|Loading maps…|Cargando mapas…
Publicado · edição como rascunho|Published · editing a draft|Publicado · edición como borrador
Rascunho privado|Private draft|Borrador privado
Publicando seu mapa…|Publishing your map…|Publicando tu mapa…
Salvando seu mapa…|Saving your map…|Guardando tu mapa…
Publicado! Todos já podem jogar na galeria.|Published! Everyone can play it in the gallery.|¡Publicado! Todos pueden jugarlo en la galería.
Salvo no seu perfil.|Saved to your profile.|Guardado en tu perfil.
Você escapou deste mapa!|You escaped this map!|¡Escapaste de este mapa!
Construa em primeira pessoa, teste sua fase e publique para outros exploradores jogarem.|Build in first person, test your level and publish it for other explorers.|Construye en primera persona, prueba tu nivel y publícalo para otros exploradores.
Coloque início, saída e 3 fusíveis. Monstros são opcionais. Móveis bloqueiam a passagem; luzes ficam no teto.|Place a spawn, exit and 3 fuses. Monsters are optional. Furniture blocks paths; lights sit on the ceiling.|Coloca inicio, salida y 3 fusibles. Los monstruos son opcionales. Los muebles bloquean el paso; las luces van en el techo.
Mire em um espaço. WASD ou joystick para andar.|Aim at a cell. Use WASD or the joystick to move.|Apunta a un espacio. Usa WASD o el joystick para moverte.

Joystick de movimento|Movement joystick|Joystick de movimiento
SOM: ON|SOUND: ON|SONIDO: SÍ
SOM: OFF|SOUND: OFF|SONIDO: NO
ENCONTRE OS FUSÍVEIS|FIND THE FUSES|BUSCA LOS FUSIBLES
ENCONTRE A PORTA VERDE|FIND THE GREEN DOOR|BUSCA LA PUERTA VERDE
CORRA! PEGUE OS 3 FUSÍVEIS|RUN! COLLECT ALL 3 FUSES|¡CORRE! RECOGE LOS 3 FUSIBLES
CORRA! 3 FUSÍVEIS NO CAMINHO|RUN! 3 FUSES ALONG THE WAY|¡CORRE! HAY 3 FUSIBLES EN EL CAMINO
CORRA ATÉ A SAÍDA!|RUN TO THE EXIT!|¡CORRE HACIA LA SALIDA!
MOEDAS|COINS|MONEDAS
moedas|coins|monedas
MOVER|MOVE|MOVERSE
OLHAR|LOOK|MIRAR
CORRER|SPRINT|CORRER
LANTERNA|FLASHLIGHT|LINTERNA
REVIVER|REVIVE|REVIVIR
REVIVER · 25|REVIVE · 25|REVIVIR · 25
V · REVIVER · 25|V · REVIVE · 25|V · REVIVIR · 25
FÔLEGO|STAMINA|RESISTENCIA
Arraste para olhar|Drag to look around|Arrastra para mirar
Avançar|Move forward|Avanzar
Esquerda|Left|Izquierda
Voltar|Back|Volver
Direita|Right|Derecha
Correr|Sprint|Correr
Lanterna|Flashlight|Linterna
SAÍDA|EXIT|SALIDA
ESCOLHA SEU DESTINO / EXPEDIÇÃO COOPERATIVA|BACKROOMS / COOPERATIVE EXPEDITION|BACKROOMS / EXPEDICIÓN COOPERATIVA
Não entre sozinho.|Don't go in alone.|No entres solo.
☷ MISSÕES|☷ MISSIONS|☷ MISIONES
🏆 RANKING|🏆 LEADERBOARD|🏆 CLASIFICACIÓN
TROCAR NOME|CHANGE NAME|CAMBIAR NOMBRE
MODO DE JOGO|GAME MODE|MODO DE JUEGO
Dificuldade|Difficulty|Dificultad
Moedas voltam em 10 s · Reviver disponível|Coins respawn in 10 s · Reviving enabled|Las monedas reaparecen en 10 s · Puedes revivir
2 monstros · Sem moedas · Sem reviver|2 monsters · No coins · No reviving|2 monstruos · Sin monedas · Sin revivir
HARDCORE · 2 MONSTROS|HARDCORE · 2 MONSTERS|HARDCORE · 2 MONSTRUOS
O mesmo desafio: 3 fusíveis e a saída.|The same goal: 3 fuses and the exit.|El mismo objetivo: 3 fusibles y la salida.
PLAY|PLAY|JUGAR
COMEÇAR NAS BACKROOMS|START IN THE BACKROOMS|EMPEZAR EN LAS BACKROOMS
3 fusíveis por fase · A saída leva à próxima fase|3 fuses per level · The exit leads to the next level|3 fusibles por nivel · La salida lleva al siguiente nivel
CRIAR SALA · ATÉ 4 PESSOAS|CREATE ROOM · UP TO 4 PLAYERS|CREAR SALA · HASTA 4 JUGADORES
CRIAR SALA|CREATE ROOM|CREAR SALA
CÓDIGO DA SALA|ROOM CODE|CÓDIGO DE LA SALA
Código da sala|Room code|Código de la sala
ENTRAR|ENTER|ENTRAR
CÂMERA: NORMAL|CAMERA: NORMAL|CÁMARA: NORMAL
CÂMERA: SUAVE|CAMERA: SLOW|CÁMARA: LENTA
CÂMERA: RÁPIDA|CAMERA: FAST|CÁMARA: RÁPIDA
Analógico suave · L3 ou LB / L1 para correr|Smooth sticks · L3 or LB / L1 to sprint|Palancas suaves · L3 o LB / L1 para correr
PC e celular na mesma sala · Sem cadastro|PC and mobile in the same room · No sign-up|PC y móvil en la misma sala · Sin registro
Tem controle? Conecte e aperte qualquer botão.|Got a controller? Connect it and press any button.|¿Tienes mando? Conéctalo y pulsa cualquier botón.
COPIAR CONVITE|COPY INVITE|COPIAR INVITACIÓN
CONVITE COPIADO|INVITE COPIED|INVITACIÓN COPIADA
Envie o convite para os outros jogadores.|Send the invite to the other players.|Envía la invitación a los demás jugadores.
INICIAR EXPEDIÇÃO|START EXPEDITION|INICIAR EXPEDICIÓN
VOLTAR AO INÍCIO|BACK TO MAIN MENU|VOLVER AL INICIO
Você não deveria estar aqui.|You shouldn't be here.|No deberías estar aquí.
Encontre os 3 fusíveis para abrir a saída.|Find all 3 fuses to open the exit.|Encuentra los 3 fusibles para abrir la salida.
Toque em A / × para mudar a sensibilidade|Press A / × to change sensitivity|Pulsa A / × para cambiar la sensibilidad
CONTINUAR|CONTINUE|CONTINUAR
Missões|Missions|Misiones
Fechar missões|Close missions|Cerrar misiones
TODAS|ALL|TODAS
EM ANDAMENTO|IN PROGRESS|EN PROGRESO
CONCLUÍDAS|COMPLETED|COMPLETADAS
CONCLUÍDA|COMPLETED|COMPLETADA
Ranking geral|Overall leaderboard|Clasificación general
Fechar ranking|Close leaderboard|Cerrar clasificación
Só entra quem zerou todas as fases. Vale o menor tempo total de cada explorador, do PLAY até a última saída.|Only players who finish every level qualify. Each explorer's fastest total time counts, from PLAY to the final exit.|Solo entran quienes completan todos los niveles. Cuenta el mejor tiempo total de cada explorador, desde JUGAR hasta la última salida.
Junte 25 moedas para reviver a equipe.|Collect 25 coins to revive the team.|Reúne 25 monedas para revivir al equipo.
V · REVIVER TODOS · 25 MOEDAS|V · REVIVE EVERYONE · 25 COINS|V · REVIVIR A TODOS · 25 MONEDAS
REGISTRO DE EXPLORAÇÃO|EXPLORATION LOG|REGISTRO DE EXPLORACIÓN
COOP / 01 — 04 JOGADORES|CO-OP / 01 — 04 PLAYERS|COOPERATIVO / 01 — 04 JUGADORES
11 FASES|11 LEVELS|11 NIVELES
Vire o celular|Turn your phone|Gira el móvil
para jogar|to play|para jugar
O labirinto fica melhor com a tela deitada.|The maze works best in landscape mode.|El laberinto se ve mejor en horizontal.
Segure o aparelho na horizontal.|Hold your device horizontally.|Sostén el dispositivo en horizontal.
ATIVAR TELA DEITADA|ENABLE LANDSCAPE MODE|ACTIVAR MODO HORIZONTAL
Se a tela não girar, desative o bloqueio de rotação do celular.|If the screen doesn't rotate, turn off rotation lock.|Si la pantalla no gira, desactiva el bloqueo de rotación.
Escreva seu nome|Enter your name|Escribe tu nombre
APAGAR · X / □|DELETE · X / □|BORRAR · X / □
CONCLUIR · Y / △|DONE · Y / △|LISTO · Y / △
CANCELAR · B / ○|CANCEL · B / ○|CANCELAR · B / ○
Direcional para escolher · A / × para confirmar|D-pad to choose · A / × to confirm|Cruceta para elegir · A / × para confirmar
CHAT GLOBAL|GLOBAL CHAT|CHAT GLOBAL
Chat global|Global chat|Chat global
Fechar chat|Close chat|Cerrar chat
Converse com todos, mesmo sem equipe. As partidas online continuam.|Chat with everyone, even without a team. Online matches keep running.|Habla con todos, incluso sin equipo. Las partidas en línea siguen en marcha.
Escreva para todos…|Write to everyone…|Escribe a todos…
Mensagem para todos|Message everyone|Mensaje para todos
ENVIAR|SEND|ENVIAR
Quem vai explorar?|Who will explore?|¿Quién va a explorar?
Escreva seu nome para começar.|Enter your name to start.|Escribe tu nombre para empezar.
NOME DO EXPLORADOR|EXPLORER NAME|NOMBRE DEL EXPLORADOR
Como você se chama?|What's your name?|¿Cómo te llamas?
Encontrem os 3 fusíveis e escapem juntos. Coletem 25 moedas e apertem V para reviver a equipe.|Find all 3 fuses and escape together. Collect 25 coins and press V to revive the team.|Encuentren los 3 fusibles y escapen juntos. Reúnan 25 monedas y pulsen V para revivir al equipo.
Encontrem os 3 fusíveis e escapem juntos. As moedas reaparecem em 10 segundos; 25 moedas revivem a equipe.|Find all 3 fuses and escape together. Coins respawn after 10 seconds; 25 coins revive the team.|Encuentren los 3 fusibles y escapen juntos. Las monedas reaparecen en 10 segundos; 25 monedas reviven al equipo.
Encontrem os 3 fusíveis e a saída. Dois monstros caçam vocês. Sem moedas e sem segunda chance.|Find all 3 fuses and the exit. Two monsters are hunting you. No coins and no second chances.|Encuentren los 3 fusibles y la salida. Dos monstruos los persiguen. Sin monedas ni segundas oportunidades.
O jogo está pausado.|The game is paused.|El juego está en pausa.
Respire. Você ainda está aqui.|Take a breath. You're still here.|Respira. Sigues aquí.
O menu está aberto, mas a partida online continua.|The menu is open, but the online match continues.|El menú está abierto, pero la partida en línea continúa.
Você encontrou o caminho de volta.|You found your way back.|Encontraste el camino de vuelta.
Você não estava sozinho.|You weren't alone.|No estabas solo.
A criatura encontrou você. Corra com Shift e mantenha distância.|The creature found you. Hold Shift to sprint and keep your distance.|La criatura te encontró. Mantén Shift para correr y aléjate.
VOLTAR À SALA|BACK TO ROOM|VOLVER A LA SALA
TENTAR NOVAMENTE|TRY AGAIN|INTENTAR DE NUEVO
JOGAR NOVAMENTE|PLAY AGAIN|JUGAR DE NUEVO
Todas as fases concluídas!|All levels completed!|¡Todos los niveles completados!
Fase concluída!|Level completed!|¡Nivel completado!
CORRA PELA SUA VIDA!|RUN FOR YOUR LIFE!|¡CORRE POR TU VIDA!
CORRA PELA SUA VIDA! Segure correr: fôlego infinito!|RUN FOR YOUR LIFE! Hold sprint: unlimited stamina!|¡CORRE POR TU VIDA! Mantén correr: ¡resistencia infinita!
CORRA! Fôlego infinito. A perseguição começa em 6 segundos!|RUN! Unlimited stamina. The chase starts in 6 seconds!|¡CORRE! Resistencia infinita. ¡La persecución empieza en 6 segundos!
CORRA! Fôlego infinito. O monstro começa a perseguir em 6 segundos.|RUN! Unlimited stamina. The monster starts chasing in 6 seconds.|¡CORRE! Resistencia infinita. El monstruo empieza a perseguirte en 6 segundos.
Procure o brilho âmbar dos fusíveis. A coleta é automática.|Look for the fuses' amber glow. They are collected automatically.|Busca el brillo ámbar de los fusibles. Se recogen automáticamente.
25 moedas! Aperte V se precisar reviver.|25 coins! Press V if you need to revive.|¡25 monedas! Pulsa V si necesitas revivir.
Energia restaurada. Encontre a porta verde!|Power restored. Find the green door!|Energía restaurada. ¡Busca la puerta verde!
Fusível coletado. Continue explorando.|Fuse collected. Keep exploring.|Fusible recogido. Sigue explorando.
A saída precisa dos 3 fusíveis.|The exit needs all 3 fuses.|La salida necesita los 3 fusibles.
Um sorriso brilha na escuridão…|A smile glows in the dark…|Una sonrisa brilla en la oscuridad…
Você escuta passos perto de você…|You hear footsteps nearby…|Oyes pasos cerca de ti…
A expedição começou. Encontrem os fusíveis juntos.|The expedition has started. Find the fuses together.|La expedición comenzó. Encuentren los fusibles juntos.
A equipe restaurou a energia! Procurem a saída verde.|The team restored power! Find the green exit.|¡El equipo restauró la energía! Busquen la salida verde.
Sua equipe encontrou um fusível!|Your team found a fuse!|¡Tu equipo encontró un fusible!
Você reviveu! 5 segundos de proteção.|You're back! 5 seconds of protection.|¡Reviviste! 5 segundos de protección.
A equipe encontrou a saída!|The team found the exit!|¡El equipo encontró la salida!
A expedição chegou ao fim.|The expedition is over.|La expedición terminó.
Você foi capturado.|You were caught.|Te atraparon.
Sua equipe continua na expedição. Aguarde o resultado ou acompanhe pela sala.|Your team is still exploring. Wait for the result or watch from the room.|Tu equipo sigue explorando. Espera el resultado o sigue la partida desde la sala.
Vocês completaram toda a expedição!|You completed the entire expedition!|¡Completaron toda la expedición!
Fase concluída. A equipe avança automaticamente.|Level completed. The team advances automatically.|Nivel completado. El equipo avanza automáticamente.
AVANÇANDO PARA A PRÓXIMA FASE…|MOVING TO THE NEXT LEVEL…|PASANDO AL SIGUIENTE NIVEL…
AGUARDE SUA EQUIPE|WAIT FOR YOUR TEAM|ESPERA A TU EQUIPO
VOLTAR AO JOGO|BACK TO GAME|VOLVER AL JUEGO
Mesmo código, mesmo labirinto. PC e celular podem jogar juntos.|Same code, same maze. PC and mobile players can play together.|Mismo código, mismo laberinto. PC y móvil pueden jugar juntos.
A expedição está em andamento.|The expedition is in progress.|La expedición está en marcha.
A equipe venceu! O anfitrião pode iniciar outra partida.|The team won! The host can start another match.|¡El equipo ganó! El anfitrión puede iniciar otra partida.
O anfitrião pode iniciar uma nova tentativa.|The host can start another attempt.|El anfitrión puede iniciar otro intento.
Inicie quando todos estiverem aqui.|Start when everyone is here.|Empieza cuando estén todos.
Aguardando o anfitrião iniciar.|Waiting for the host to start.|Esperando a que el anfitrión empiece.
ANFITRIÃO|HOST|ANFITRIÓN
PRONTO|READY|LISTO
CAPTURADO|CAUGHT|ATRAPADO
EQUIPE CONECTADA|TEAM CONNECTED|EQUIPO CONECTADO
RECONECTANDO…|RECONNECTING…|RECONECTANDO…
SINCRONIZANDO MOVIMENTO…|SYNCING MOVEMENT…|SINCRONIZANDO MOVIMIENTO…
Todos os exploradores foram capturados. Voltem à sala para tentar novamente.|All explorers were caught. Return to the room to try again.|Atraparon a todos los exploradores. Vuelvan a la sala para intentarlo de nuevo.
Você precisa de 25 moedas para reviver.|You need 25 coins to revive.|Necesitas 25 monedas para revivir.
Todos os exploradores estão vivos.|All explorers are alive.|Todos los exploradores están vivos.
Equipe revivida! 25 moedas utilizadas.|Team revived! 25 coins used.|¡Equipo revivido! Se usaron 25 monedas.
Hardcore: não é possível reviver.|Hardcore: reviving is disabled.|Hardcore: no puedes revivir.
Aperte V ou toque no botão para voltar à expedição.|Press V or tap the button to rejoin the expedition.|Pulsa V o toca el botón para volver a la expedición.
Normal: moedas reaparecem no mesmo lugar em 10 segundos.|Normal: coins respawn in the same spot after 10 seconds.|Normal: las monedas reaparecen en el mismo lugar en 10 segundos.
Hardcore: dois monstros, sem moedas e sem reviver.|Hardcore: two monsters, no coins and no reviving.|Hardcore: dos monstruos, sin monedas ni reapariciones.
Carregando tempos…|Loading times…|Cargando tiempos…
Quem zerou o jogo em menos tempo|Fastest complete runs|Quién completó el juego más rápido
Ainda ninguém zerou o jogo. Seja o primeiro!|Nobody has finished the game yet. Be the first!|Nadie ha completado el juego todavía. ¡Sé el primero!
Não foi possível carregar o ranking. Confira a conexão e tente novamente.|Couldn't load the leaderboard. Check your connection and try again.|No se pudo cargar la clasificación. Revisa la conexión e inténtalo de nuevo.
Carregando suas missões…|Loading your missions…|Cargando tus misiones…
Missões aguardando conexão para salvar.|Missions will save when you're connected.|Las misiones se guardarán cuando tengas conexión.
Nenhuma mensagem ainda. Diga oi para todos!|No messages yet. Say hi to everyone!|Todavía no hay mensajes. ¡Saluda a todos!
Conectando ao chat global…|Connecting to global chat…|Conectando al chat global…
Escreva seu nome para entrar.|Enter your name to join.|Escribe tu nombre para entrar.
Escreva um nome com até 32 caracteres.|Enter a name with up to 32 characters.|Escribe un nombre de hasta 32 caracteres.
Digite o código de 6 caracteres enviado pelo anfitrião.|Enter the 6-character code from the host.|Escribe el código de 6 caracteres del anfitrión.
Não foi possível conectar. Atualize a página e tente de novo.|Couldn't connect. Refresh the page and try again.|No se pudo conectar. Actualiza la página e inténtalo de nuevo.
A conexão demorou demais. Confira a internet e tente novamente.|The connection timed out. Check your internet and try again.|La conexión tardó demasiado. Revisa internet e inténtalo de nuevo.
Conexão interrompida. Tentando reconectar…|Connection lost. Reconnecting…|Conexión interrumpida. Reconectando…
Não foi possível carregar ou salvar suas missões. Tente entrar novamente.|Couldn't load or save your missions. Try signing in again.|No se pudieron cargar o guardar tus misiones. Intenta entrar de nuevo.
Primeiros passos|First steps|Primeros pasos
Entre em uma partida.|Join a game.|Entra en una partida.
Explorador curioso|Curious explorer|Explorador curioso
Jogue em 3 cenários diferentes.|Play in 3 different levels.|Juega en 3 niveles diferentes.
Conhecedor das Backrooms|Backrooms expert|Experto en las Backrooms
Uma luz de esperança|A ray of hope|Una luz de esperanza
Encontre 1 fusível em uma partida.|Find 1 fuse in a game.|Encuentra 1 fusible en una partida.
Eletricista|Electrician|Electricista
Encontre os 3 fusíveis na mesma partida.|Find all 3 fuses in one game.|Encuentra los 3 fusibles en la misma partida.
Reserva de emergência|Emergency fund|Reserva de emergencia
De volta para casa|Back home|De vuelta a casa
Escapista|Escape artist|Escapista
Veterano|Veteran|Veterano
Melhor acompanhado|Better together|Mejor acompañado
Jogue com pelo menos outro explorador na sala.|Play with at least one other explorer.|Juega con al menos otro explorador en la sala.
Saída em equipe|Team escape|Escape en equipo
Vença uma partida com pelo menos 2 jogadores.|Win a game with at least 2 players.|Gana una partida con al menos 2 jugadores.
Segunda chance|Second chance|Segunda oportunidad
Use 25 moedas para reviver no Normal.|Use 25 coins to revive in Normal mode.|Usa 25 monedas para revivir en modo Normal.
Sem segunda chance|No second chances|Sin segundas oportunidades
Vença uma partida Hardcore.|Win a Hardcore game.|Gana una partida Hardcore.
Encontre os 3 fusíveis e escape deste cenário.|Find all 3 fuses and escape this level.|Encuentra los 3 fusibles y escapa de este nivel.
Todas as missões deste filtro foram concluídas!|All missions in this filter are complete!|¡Todas las misiones de este filtro están completadas!
Você ainda não concluiu missões. Entre em uma partida para começar!|No missions completed yet. Join a game to start!|Todavía no has completado misiones. ¡Entra en una partida para empezar!
⚙️ CONFIGURAÇÕES|⚙️ SETTINGS|⚙️ AJUSTES
Voltar para configurações|Back to settings|Volver a los ajustes
Abrir missões|Open missions|Abrir misiones
Filtrar missões|Filter missions|Filtrar misiones
Ativar tela cheia e modo deitado|Enable fullscreen and landscape|Activar pantalla completa y modo horizontal
Ativar ou desativar som|Toggle sound|Activar o desactivar sonido
Pausar jogo|Pause game|Pausar juego
Nome do explorador|Explorer name|Nombre del explorador
Controle conectado · A / × confirma · B / ○ volta|Controller connected · A / × confirm · B / ○ back|Mando conectado · A / × confirma · B / ○ vuelve
Controle desconectado. Reconecte para continuar.|Controller disconnected. Reconnect to continue.|Mando desconectado. Conéctalo para continuar.
Use as setas ← → para olhar.|Use ← → to look around.|Usa ← → para mirar.
Use a opção de tela cheia do seu navegador.|Use your browser's fullscreen option.|Usa la opción de pantalla completa del navegador.
Se a tela continuar em pé, vire o aparelho e desative o bloqueio de rotação.|If the screen stays vertical, turn your device and disable rotation lock.|Si la pantalla sigue vertical, gira el dispositivo y desactiva el bloqueo de rotación.
Seu progresso fica salvo neste navegador. No multiplayer, fusíveis, moedas e vitórias contam para toda a equipe.|Your progress is saved. In multiplayer, fuses, coins and wins count for the whole team.|Tu progreso se guarda. En multijugador, los fusibles, las monedas y las victorias cuentan para todo el equipo.
14 FASES|14 LEVELS|14 NIVELES
14 fases · Final Glitch: 1 → 5 → 3 fusíveis|14 levels · Glitch finale: 1 → 5 → 3 fuses|14 niveles · Final Glitch: 1 → 5 → 3 fusibles
BACKROOMS GLITCH · Pegue 1 fusível e atravesse a saída.|BACKROOMS GLITCH · Collect 1 fuse and cross the exit.|BACKROOMS GLITCH · Recoge 1 fusible y cruza la salida.
A realidade quebrou. Pegue 5 fusíveis para abrir o caminho ao passado.|Reality has broken. Collect 5 fuses to open the way to the past.|La realidad se rompió. Recoge 5 fusibles para abrir el camino al pasado.
Você voltou ao seu passado. Pegue 3 fusíveis e volte ao mundo normal.|You returned to your past. Collect 3 fuses to return to the normal world.|Volviste a tu pasado. Recoge 3 fusibles y vuelve al mundo normal.
Você voltou ao mundo normal!|You returned to the normal world!|¡Volviste al mundo normal!
Vocês voltaram ao mundo normal!|You all returned to the normal world!|¡Volvieron al mundo normal!
O passado ficou para trás. Vocês escaparam das Backrooms Glitch juntos!|The past is behind you. You escaped Backrooms Glitch together!|El pasado quedó atrás. ¡Escaparon de Backrooms Glitch juntos!
Colete todos os fusíveis desta fase para abrir a saída.|Collect every fuse in this level to open the exit.|Recoge todos los fusibles de este nivel para abrir la salida.
VOLTE AO MUNDO NORMAL|RETURN TO THE NORMAL WORLD|VUELVE AL MUNDO NORMAL
ATRAVESSE PARA O PASSADO|CROSS INTO THE PAST|CRUZA HACIA EL PASADO
SEU PASSADO · ENCONTRE OS FUSÍVEIS|YOUR PAST · FIND THE FUSES|TU PASADO · ENCUENTRA LOS FUSIBLES
CASA|HOME|CASA
PASSADO|PAST|PASADO
Encontrem os fusíveis de cada fase e escapem juntos. Coletem 25 moedas e apertem V para reviver a equipe.|Find each level's fuses and escape together. Collect 25 coins and press V to revive the team.|Encuentren los fusibles de cada nivel y escapen juntos. Reúnan 25 monedas y pulsen V para revivir al equipo.
Encontrem os fusíveis de cada fase e escapem juntos. As moedas reaparecem em 10 segundos; 25 moedas revivem a equipe.|Find each level's fuses and escape together. Coins respawn in 10 seconds; 25 coins revive the team.|Encuentren los fusibles de cada nivel y escapen juntos. Las monedas reaparecen en 10 segundos; 25 monedas reviven al equipo.
Encontrem os fusíveis de cada fase e a saída. Dois monstros caçam vocês. Sem moedas e sem segunda chance.|Find each level's fuses and the exit. Two monsters hunt you. No coins or second chances.|Encuentren los fusibles de cada nivel y la salida. Dos monstruos los persiguen. Sin monedas ni segundas oportunidades.
MAPA|MAP|MAPA
MAPA DA FASE|LEVEL MAP|MAPA DEL NIVEL
▲ Você|▲ You|▲ Tú
◆ Fusível|◆ Fuse|◆ Fusible
□ Saída|□ Exit|□ Salida
Mostrar ou esconder mapa (M)|Show or hide map (M)|Mostrar u ocultar mapa (M)
Mapa da fase|Level map|Mapa del nivel
Mapa com sua posição, fusíveis e saída|Map with your position, fuses and exit|Mapa con tu posición, fusibles y salida
`;
const dictionaries = { en: {}, es: {} };
for (const row of rows.trim().split('\n')) {
  const [pt, en, es] = row.split('|');
  dictionaries.en[pt] = en;
  dictionaries.es[pt] = es;
}
const patterns = [
  [
    /^Fusíveis necessários: (\d+)\. Encontre a saída\.$/,
    'Fuses required: $1. Find the exit.',
    'Fusibles necesarios: $1. Encuentra la salida.',
  ],
  [
    /^O passado ficou para trás\. Backrooms Glitch concluída! Tempo total: (.*)$/,
    'The past is behind you. Backrooms Glitch complete! Total time: $1',
    'El pasado quedó atrás. ¡Backrooms Glitch completado! Tiempo total: $1',
  ],
  [
    /^(\d+) \/ (\d+) missões concluídas$/,
    '$1 / $2 missions completed',
    '$1 / $2 misiones completadas',
  ],
  [/^Explorador: (.*)$/, 'Explorer: $1', 'Explorador: $1'],
  [
    /^Jogue nas (\d+) fases disponíveis\.$/,
    'Play all $1 available levels.',
    'Juega en los $1 niveles disponibles.',
  ],
  [/^Tesouro de (\d+)$/, '$1-coin treasure', 'Tesoro de $1 monedas'],
  [
    /^Acumule (\d+) moedas de saldo em uma partida Normal\.$/,
    'Hold $1 coins in a Normal game.',
    'Acumula $1 monedas en una partida Normal.',
  ],
  [/^Vença (\d+) partidas?\.$/, 'Win $1 games.', 'Gana $1 partidas.'],
  [
    /^Você completou a expedição das Backrooms! Tempo total: (.*)$/,
    'You completed the Backrooms expedition! Total time: $1',
    '¡Completaste la expedición de las Backrooms! Tiempo total: $1',
  ],
  [
    /^A equipe avança para (.*) em instantes…$/,
    'The team moves to $1 shortly…',
    'El equipo pasa a $1 en unos instantes…',
  ],
  [
    /^Escapou com os 3 fusíveis em (.*)$/,
    'Escaped with all 3 fuses in $1',
    'Escapaste con los 3 fusibles en $1',
  ],
  [/^Vocês escaparam juntos em (.*)$/, 'You escaped together in $1', 'Escaparon juntos en $1'],
  [/^(\d+) online · Todas as salas$/, '$1 online · All rooms', '$1 en línea · Todas las salas'],
  [
    /^Envie este código aos amigos: (.*)$/,
    'Send this code to friends: $1',
    'Envía este código a tus amigos: $1',
  ],
  [
    /^(\d+) \/ 4 jogadores · Inicie quando todos estiverem aqui\.$/,
    '$1 / 4 players · Start when everyone is here.',
    '$1 / 4 jugadores · Empieza cuando estén todos.',
  ],
  [
    /^(\d+) \/ 4 jogadores · Aguardando o anfitrião iniciar\.$/,
    '$1 / 4 players · Waiting for the host.',
    '$1 / 4 jugadores · Esperando al anfitrión.',
  ],
  [/^FASE (\d+) \/ (\d+) · (.*)$/, 'LEVEL $1 / $2 · $3', 'NIVEL $1 / $2 · $3'],
  [/^SALA (.*)$/, 'ROOM $1', 'SALA $1'],
];
let language = 'pt';
try {
  const saved = localStorage.getItem('backrooms.language');
  if (['pt', 'en', 'es'].includes(saved)) language = saved;
} catch {}
function translate(text) {
  if (language === 'pt') return text;
  const key = text.trim(),
    dict = dictionaries[language];
  let value = dict[key];
  if (!value)
    for (const [re, en, es] of patterns)
      if (re.test(key)) {
        value = key.replace(re, language === 'en' ? en : es);
        break;
      }
  if (!value && /^(WASD |LS MOVER)/.test(key)) {
    value = key;
    for (const [a, b] of Object.entries({
      MOVER: language === 'en' ? 'MOVE' : 'MOVERSE',
      OLHAR: language === 'en' ? 'LOOK' : 'MIRAR',
      CORRER: language === 'en' ? 'SPRINT' : 'CORRER',
      LANTERNA: language === 'en' ? 'FLASHLIGHT' : 'LINTERNA',
      REVIVER: language === 'en' ? 'REVIVE' : 'REVIVIR',
    }))
      value = value.replaceAll(a, b);
  }
  return value ? text.replace(key, value) : text;
}
const originals = new WeakMap(),
  attributes = new WeakMap();
function skip(node) {
  return !!node.parentElement?.closest(
    'script,style,textarea,[translate="no"],.chat-message,.leaderboard-row span,#roster strong,#teamStatus,#padKeyboardValue',
  );
}
function textNode(node) {
  if (skip(node)) return;
  const current = node.nodeValue;
  let data = originals.get(node);
  if (!data || current !== data.output) data = { source: current };
  const output = translate(data.source);
  if (output !== current) node.nodeValue = output;
  data.output = output;
  originals.set(node, data);
}
function element(node) {
  if (node.closest?.('[translate="no"]')) return;
  let data = attributes.get(node) || {};
  for (const key of ['placeholder', 'aria-label', 'title']) {
    const current = node.getAttribute(key);
    if (current === null) continue;
    if (!data[key] || data[key].output !== current) data[key] = { source: current };
    const output = translate(data[key].source);
    if (output !== current) node.setAttribute(key, output);
    data[key].output = output;
  }
  attributes.set(node, data);
}
function walk(root) {
  if (root.nodeType === 3) {
    textNode(root);
    return;
  }
  if (root.nodeType !== 1) return;
  element(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeType === 3) textNode(n);
    else element(n);
  }
}
const config = {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['placeholder', 'aria-label', 'title'],
};
const observer = new MutationObserver(records => {
  observer.disconnect();
  for (const record of records) {
    if (record.type === 'childList') for (const n of record.addedNodes) walk(n);
    else if (record.type === 'characterData') textNode(record.target);
    else element(record.target);
  }
  observer.observe(document.body, config);
});
const select = document.getElementById('languageSelect');
function setLanguage(value) {
  if (!['pt', 'en', 'es'].includes(value)) return;
  language = value;
  observer.disconnect();
  document.documentElement.lang = language === 'pt' ? 'pt-BR' : language;
  walk(document.body);
  select.value = language;
  document.getElementById('languageLabel').textContent = {
    pt: '🌐 IDIOMA',
    en: '🌐 LANGUAGE',
    es: '🌐 IDIOMA',
  }[language];
  try {
    localStorage.setItem('backrooms.language', language);
  } catch {}
  observer.observe(document.body, config);
}
select.addEventListener('change', () => setLanguage(select.value));
select.addEventListener('keydown', event => event.stopPropagation());
select.addEventListener('pointerdown', () =>
  document.dispatchEvent(new Event('game-language-change')),
);
window.gameI18n = { t: translate, setLanguage };
setLanguage(language);
