import {createWorld,findRoute,PHASE_ORDER,validateCustomMap} from '../public/world.js';
const LEVELS=PHASE_ORDER;
function validatedLevel(value='backrooms'){if(!LEVELS.includes(value))throw new ApiError('Escolha um dos cenários disponíveis.');return value;}
function validatedMode(value='normal'){if(!['normal','hardcore'].includes(value))throw new ApiError('Escolha Normal ou Hardcore.');return value;}
const MAX_PLAYERS=4,ACTIVE_MS=18000,TTL=7200000;
function beginPhase(room,now,level=room.level){
 if(!room.campaignStarted&&level===PHASE_ORDER[0])room.campaignStarted=now;room.level=level;room.seed=crypto.getRandomValues(new Uint32Array(1))[0];room.world=createWorld(room.seed,level);
 room.status='playing';room.started=now;room.finished=0;room.lastTick=now;room.round++;room.balance=0;room.collectedCoins=[];room.coinRespawns={};room.fuses=room.world.fuses.map(()=>false);room.enemy={...room.world.enemy};room.smile=room.mode==='hardcore'?{...room.world.smile}:null;
 for(const p of room.players)Object.assign(p,{x:1.5,y:1.5,a:0,alive:true,seq:0,moveOrdinal:0,moveCredit:.5,moveClock:now,protectedUntil:0,respawns:0});
}

const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
class ApiError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function dbFor(env){if(!env.DB)throw new ApiError('Salas indisponíveis neste momento. Tente novamente.',503);return env.DB;}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const isOpen=(grid,x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&grid[Math.floor(y)]?.[Math.floor(x)]===0;
function tickRoom(room,now){
 room.level=room.level||'backrooms';room.mode=room.mode||'normal';
 if(room.campaign&&room.status==='won'&&room.finished&&now-room.finished>=3000){const next=PHASE_ORDER[PHASE_ORDER.indexOf(room.level)+1];if(next)beginPhase(room,now,next);}
 if(room.mode==='hardcore'&&!room.smile){room.world.smile=room.world.smile||createWorld(room.seed,room.level).smile;room.smile={...room.world.smile};}
 // Rooms created before the coin update retain their original map and progress.
 if(!room.world.coins)room.world.coins=createWorld(room.seed,room.level).coins;
 if(!Array.isArray(room.collectedCoins))room.collectedCoins=[];
 if(!Number.isFinite(room.balance))room.balance=0;
 if(!room.coinRespawns){room.coinRespawns={};for(const id of room.collectedCoins)room.coinRespawns[id]=now+10000;}
 room.collectedCoins=room.collectedCoins.filter(id=>{if(room.coinRespawns[id]===undefined)room.coinRespawns[id]=now+10000;if(now>=room.coinRespawns[id]){delete room.coinRespawns[id];return false;}return true;});
 if(room.mode==='hardcore'){room.balance=0;room.collectedCoins=[];room.coinRespawns={};}
 const dt=Math.min(.75,Math.max(0,(now-room.lastTick)/1000));room.lastTick=now;
 room.players=room.players.filter(p=>now-p.seen<TTL);
 const online=room.players.filter(p=>now-p.seen<ACTIVE_MS);
 if(!online.some(p=>p.id===room.host)&&online.length)room.host=online[0].id;
 if(room.status!=='playing')return;
 const alive=online.filter(p=>p.alive);
 if(!alive.length){if(online.length)room.status='lost';return;}
 if(now-room.started<(room.level==='run'?6000:22000))return;
 for(const enemy of room.mode==='hardcore'?[room.enemy,room.smile]:[room.enemy]){
 if(!enemy.path?.length||(!enemy.pathAt||now-enemy.pathAt>1000)&&Math.hypot(enemy.x-Math.floor(enemy.x)-.5,enemy.y-Math.floor(enemy.y)-.5)<.02){let paths=alive.map(p=>findRoute(room.world.grid,Math.floor(enemy.x),Math.floor(enemy.y),Math.floor(p.x),Math.floor(p.y))).filter(p=>p.length);paths.sort((a,b)=>a.length-b.length);enemy.path=paths[0]?.slice(1)||[];enemy.pathAt=now;}
 // Finish each cell-center waypoint before turning to prevent cutting through walls.
 let remaining=dt*(room.level==='run'?(enemy.type==='smile'?2.5:2.65):((enemy.type==='smile'?.7:.75)+room.fuses.filter(Boolean).length*.15));
 while(remaining>0&&enemy.path?.length){let target=enemy.path[0],dx=target[0]+.5-enemy.x,dy=target[1]+.5-enemy.y,d=Math.hypot(dx,dy);if(d<.001){enemy.path.shift();continue;}let amount=Math.min(d,remaining);enemy.x+=dx/d*amount;enemy.y+=dy/d*amount;remaining-=amount;if(amount===d)enemy.path.shift();else break;}
 for(const p of alive)if(now>=(p.protectedUntil||0)&&distance(p,enemy)<.43)p.alive=false;
 }
 if(alive.every(p=>!p.alive))room.status='lost';
}
function safeRoom(room,now){return {code:room.code,adminUsed:!!room.adminUsed,campaign:!!room.campaign,campaignStarted:room.campaignStarted||0,level:room.level||'backrooms',mode:room.mode||'normal',smile:room.mode==='hardcore'&&room.smile?{x:room.smile.x,y:room.smile.y,type:'smile'}:null,seed:room.seed,host:room.host,status:room.status,started:room.started,finished:room.finished||0,now,round:room.round,fuses:room.fuses,balance:room.balance||0,collectedCoins:room.collectedCoins||[],enemy:{x:room.enemy.x,y:room.enemy.y,type:'enemy'},players:room.players.filter(p=>now-p.seen<ACTIVE_MS).map(({id,name,color,x,y,a,alive,respawns=0})=>({id,name,color,x,y,a,alive,respawns})),messages:room.messages||[],capacity:MAX_PLAYERS};}
async function mutate(db,code,action){for(let attempt=0;attempt<6;attempt++){const row=await db.prepare('SELECT state,revision,updated_at FROM rooms WHERE code=?').bind(code).first();if(!row||Date.now()-row.updated_at>TTL)throw new ApiError('Sala não encontrada ou expirada. Confira o código.',404);const room=JSON.parse(row.state),now=Date.now();tickRoom(room,now);const extra=action(room,now)||{};if(room.status==='won'){if(!Number.isFinite(room.finished)||room.finished<=room.started)room.finished=now;}else room.finished=0;const result=await db.prepare('UPDATE rooms SET state=?,revision=revision+1,updated_at=? WHERE code=? AND revision=?').bind(JSON.stringify(room),now,code,row.revision).run();if(result.meta.changes)return {...extra,room:{...safeRoom(room,now),revision:row.revision+1}};}throw new ApiError('A sala está ocupada. Tente novamente.',409);}

function validateMovement(room,p,body,now,previousSeen){
 const reject=reason=>({accepted:false,reason,ackMovement:p.moveOrdinal||0});
 if(body.respawns!==undefined&&body.respawns!==(p.respawns||0))return reject('respawn');
 if(!Number.isFinite(body.x)||!Number.isFinite(body.y)||!Number.isFinite(body.a)||Math.abs(body.a)>1e8)return reject('invalid');
 const hasTrail=Array.isArray(body.trail);let points=[];
 if(hasTrail){
  if(body.trail.length>96)return reject('invalid');let ordinal=0;
  for(const point of body.trail){if(!Array.isArray(point)||point.length!==3||!Number.isSafeInteger(point[0])||point[0]<=ordinal||!Number.isFinite(point[1])||!Number.isFinite(point[2]))return reject('invalid');ordinal=point[0];if(point[0]>(p.moveOrdinal||0))points.push(point);}
  const last=body.trail.at(-1);if(last&&Math.hypot(last[1]-body.x,last[2]-body.y)>.01)return reject('invalid');
  if(!points.length&&Math.hypot(body.x-p.x,body.y-p.y)>.01)return reject('invalid');
 }else points=[[0,body.x,body.y]];
 let x=p.x,y=p.y,total=0;
 for(const [,nx,ny] of points){const d=Math.hypot(nx-x,ny-y),steps=Math.max(1,Math.ceil(d/.06));if(d>6)return reject('speed');total+=d;for(let i=1;i<=steps;i++)if(!isOpen(room.world.grid,x+(nx-x)*i/steps,y+(ny-y)*i/steps))return reject('wall');x=nx;y=ny;}
 const credit=Math.min(6,(p.moveCredit??.5)+Math.max(0,now-(p.moveClock??previousSeen))/1000*3.5);
 p.moveCredit=credit;p.moveClock=now;
 if(total>credit+.001)return reject('speed');
 p.moveCredit=Math.max(0,credit-total);p.x=x;p.y=y;p.a=body.a;if(hasTrail&&points.length)p.moveOrdinal=points.at(-1)[0];
 return {accepted:true,ackMovement:p.moveOrdinal||0};
}

function adminName(name){return name?.trim().toLowerCase()==='lucca416453416453admin';}
function nameOf(body){let name=typeof body.name==='string'?body.name.trim().replace(/[\x00-\x1f\x7f]/g,''):'';if(name.length<1||name.length>32)throw new ApiError('Escreva um nome com até 32 caracteres.');return name;}
const colors=['#ddbc45','#58b7c8','#dc7958','#a58ad5'];
function newPlayer(name,now,existing=[]){return {id:crypto.randomUUID(),token:crypto.randomUUID()+crypto.randomUUID(),name,color:colors.find(c=>!existing.some(p=>p.color===c))||colors[0],x:1.5,y:1.5,a:0,alive:true,seen:now,seq:0};}
function authorize(room,body){const p=room.players.find(p=>p.id===body.id&&p.token===body.token);if(!p)throw new ApiError('Sua sessão da sala expirou. Entre novamente.',401);return p;}
async function globalChat(db,action,body){
 const now=Date.now();
 if(action==='session'){
  const name=nameOf(body),id=crypto.randomUUID(),token=crypto.randomUUID()+crypto.randomUUID(),color=colors[crypto.getRandomValues(new Uint8Array(1))[0]%colors.length];
  await db.prepare('INSERT INTO chat_sessions(id,token,name,color,seen) VALUES(?,?,?,?,?)').bind(id,token,name,color,now).run();
  await db.prepare('DELETE FROM chat_sessions WHERE seen<?').bind(now-TTL).run();
  return {id,token,name};
 }
 if(!['poll','send'].includes(action))throw new ApiError('Ação não encontrada.',404);
 const p=await db.prepare('SELECT id,name,color FROM chat_sessions WHERE id=? AND token=? AND seen>?').bind(body.id||'',body.token||'',now-TTL).first();
 if(!p)throw new ApiError('Reconectando ao chat global…',401);
 if(body.name){p.name=nameOf(body);await db.prepare('UPDATE chat_sessions SET name=? WHERE id=?').bind(p.name,p.id).run();}
 await db.prepare('UPDATE chat_sessions SET seen=? WHERE id=?').bind(now,p.id).run();
 if(action==='send'){
  const text=typeof body.text==='string'?body.text.replace(/[\x00-\x1f\x7f]/g,' ').trim():'';
  if(!text||text.length>240)throw new ApiError('Escreva uma mensagem com até 240 caracteres.');
  if(typeof body.messageId!=='string'||!/^[a-zA-Z0-9-]{8,64}$/.test(body.messageId))throw new ApiError('Mensagem inválida.');
  const old=await db.prepare('SELECT id FROM chat_messages WHERE sender=? AND request_id=?').bind(p.id,body.messageId).first();
  if(!old){
   const inserted=await db.prepare('INSERT OR IGNORE INTO chat_messages(request_id,sender,name,color,text,created) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE sender=? AND created>?) RETURNING id').bind(body.messageId,p.id,p.name,p.color,text,now,p.id,now-1000).first();
   if(!inserted){const retry=await db.prepare('SELECT id FROM chat_messages WHERE sender=? AND request_id=?').bind(p.id,body.messageId).first();if(!retry)throw new ApiError('Espere um segundo antes de enviar outra mensagem.',429);}
  }
  await db.prepare('DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 100)').bind().run();
 }
 const messages=await db.prepare('SELECT id,sender,name,color,text,created AS at FROM chat_messages WHERE created>? ORDER BY id DESC LIMIT 50').bind(now-86400000).all();
 const online=await db.prepare('SELECT COUNT(*) AS total FROM chat_sessions WHERE seen>?').bind(now-ACTIVE_MS).first();
 return {messages:messages.results.reverse(),online:online.total};
}
async function explorerProfile(db,action,body){
 const profile=nameOf(body).normalize('NFKC').toLocaleLowerCase('pt-BR');
 if(!['load','save'].includes(action))throw new ApiError('Ação não encontrada.',404);
 if(action==='save'){
  const progress=body.progress;
  if(!progress||typeof progress!=='object'||Array.isArray(progress)||Object.keys(progress).length>30)throw new ApiError('Progresso inválido.');
  for(const [key,value] of Object.entries(progress))if(!/^(visit-|win-|credited-)[a-zA-Z0-9-]{1,90}$/.test(key)&&!['explored','fuses','coins','wins','coop','coopWins','rescues','hardWins'].includes(key)||!Number.isSafeInteger(value)||value<0||value>1000000000)throw new ApiError('Progresso inválido.');
  await db.prepare('INSERT INTO explorer_missions(profile,key,value) SELECT ?,key,value FROM json_each(?) WHERE true ON CONFLICT(profile,key) DO UPDATE SET value=MAX(explorer_missions.value,excluded.value)').bind(profile,JSON.stringify(progress)).run();
 }
 const rows=await db.prepare('SELECT key,value FROM explorer_missions WHERE profile=?').bind(profile).all();
 return {profile,progress:Object.fromEntries(rows.results.map(r=>[r.key,r.value]))};
}
async function globalLeaderboard(db,action,body){
 if(action==='top'){
  const rows=await db.prepare('SELECT name,milliseconds,level,updated_at AS updatedAt FROM campaign_leaderboard WHERE level=? ORDER BY milliseconds ASC,updated_at ASC,profile COLLATE NOCASE ASC LIMIT 50').bind(PHASE_ORDER.at(-1)).all();
  return {entries:rows.results};
 }
 if(action!=='submit')throw new ApiError('Ação não encontrada.',404);
 let name=nameOf(body),milliseconds=body.milliseconds;
 if(body.code){const row=await db.prepare('SELECT state FROM rooms WHERE code=?').bind(body.code).first();if(!row)throw new ApiError('Sala não encontrada.',404);const room=JSON.parse(row.state),p=authorize(room,body);if(room.adminUsed||!room.campaign||room.status!=='won'||room.level!==PHASE_ORDER.at(-1)||!room.campaignStarted)throw new ApiError('Complete todas as fases para entrar no ranking.',409);name=p.name;milliseconds=room.finished-room.campaignStarted;}
 else if(body.completed!==true||body.phases!==PHASE_ORDER.length||body.level!==PHASE_ORDER.at(-1))throw new ApiError('Complete todas as fases para entrar no ranking.',409);
 if(adminName(name))throw new ApiError('Partidas admin não entram no ranking.',409);
 const profile=name.normalize('NFKC').toLocaleLowerCase('pt-BR');
 if(!Number.isSafeInteger(milliseconds)||milliseconds<1000||milliseconds>86400000)throw new ApiError('Tempo inválido.');
 const level=validatedLevel(body.level);
 await db.prepare('INSERT INTO campaign_leaderboard(profile,name,milliseconds,level,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile) DO UPDATE SET name=excluded.name,milliseconds=excluded.milliseconds,level=excluded.level,updated_at=excluded.updated_at WHERE campaign_leaderboard.level<>excluded.level OR excluded.milliseconds<campaign_leaderboard.milliseconds').bind(profile,name,milliseconds,level,Date.now()).run();
 const row=await db.prepare('SELECT name,milliseconds,level FROM campaign_leaderboard WHERE profile=?').bind(profile).first();
 return {entry:row};
}
async function customMapsApi(db,action,body){
 const now=Date.now();let owner='',author='';
 if(body.sessionId&&body.sessionToken){const session=await db.prepare('SELECT name FROM chat_sessions WHERE id=? AND token=? AND seen>?').bind(body.sessionId,body.sessionToken,now-TTL).first();if(!session)throw new ApiError('Entre novamente para salvar seus mapas.',401);author=session.name;owner=author.normalize('NFKC').toLocaleLowerCase('pt-BR');}
 const requireOwner=()=>{if(!owner)throw new ApiError('Entre com seu nome para acessar seus mapas.',401);};
 if(action==='gallery'||action==='mine'){
  if(action==='mine')requireOwner();
  const offset=Number.isSafeInteger(body.offset)&&body.offset>=0?Math.min(body.offset,10000):0;
  const field=action==='mine'?'data':'published_data';
  const where=action==='mine'?'owner=?':'published_data IS NOT NULL';
  const rows=await db.prepare(`SELECT id,author,revision,updated_at AS updatedAt,published_data IS NOT NULL AS published,json_extract(${field},'$.title') AS title,json_extract(${field},'$.theme') AS theme,json_extract(${field},'$.grid') AS preview FROM custom_maps WHERE ${where} ORDER BY updated_at DESC,id ASC LIMIT 13 OFFSET ?`).bind(...(action==='mine'?[owner,offset]:[offset])).all();
  return {maps:rows.results.slice(0,12),nextOffset:rows.results.length>12?offset+12:null};
 }
 if(action==='save'){
  requireOwner();let map;try{map=validateCustomMap(body.map,body.publish===true);}catch(e){throw new ApiError(e.message);}
  const data=JSON.stringify(map);
  if(body.mapId){
   const old=await db.prepare('SELECT owner,revision FROM custom_maps WHERE id=?').bind(body.mapId).first();if(!old||old.owner!==owner)throw new ApiError('Este mapa não pertence ao seu perfil.',403);
   const r=await db.prepare('UPDATE custom_maps SET data=?,author=?,published_data=CASE WHEN ?=1 THEN ? ELSE published_data END,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?').bind(data,author,body.publish===true?1:0,data,now,body.mapId,owner,body.revision).run();
   if(!r.meta.changes)throw new ApiError('Este mapa foi atualizado em outra aba. Reabra em Meus mapas antes de editar.',409);
   return {mapId:body.mapId,revision:old.revision+1,published:body.publish===true};
  }
  const id=crypto.randomUUID();const inserted=await db.prepare('INSERT INTO custom_maps(id,owner,author,data,published_data,revision,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM custom_maps WHERE owner=?)<20').bind(id,owner,author,data,body.publish===true?data:null,now,now,owner).run();
  if(!inserted.meta.changes)throw new ApiError('Seu perfil já tem 20 mapas. Exclua um para criar outro.',409);
  return {mapId:id,revision:1,published:body.publish===true};
 }
 if(!['get','unpublish','delete'].includes(action))throw new ApiError('Ação não encontrada.',404);
 if(typeof body.mapId!=='string'||body.mapId.length>64)throw new ApiError('Mapa inválido.');
 const row=await db.prepare('SELECT * FROM custom_maps WHERE id=?').bind(body.mapId).first();if(!row)throw new ApiError('Mapa não encontrado.',404);
 if(action==='get'){
  const edit=body.edit===true;if(edit){requireOwner();if(row.owner!==owner)throw new ApiError('Este mapa não pertence ao seu perfil.',403);}
  if(!edit&&!row.published_data)throw new ApiError('Este mapa ainda não está publicado.',404);
  return {mapId:row.id,revision:row.revision,author:row.author,map:JSON.parse(edit?row.data:row.published_data),published:!!row.published_data};
 }
 requireOwner();if(row.owner!==owner)throw new ApiError('Este mapa não pertence ao seu perfil.',403);
 if(action==='delete')await db.prepare('DELETE FROM custom_maps WHERE id=? AND owner=? AND revision=?').bind(row.id,owner,body.revision).run().then(r=>{if(!r.meta.changes)throw new ApiError('O mapa mudou. Atualize a lista.',409);});
 else{const r=await db.prepare('UPDATE custom_maps SET published_data=NULL,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?').bind(now,row.id,owner,body.revision).run();if(!r.meta.changes)throw new ApiError('O mapa mudou. Atualize a lista.',409);}
 return {ok:true};
}

export async function api(request,env){
 try{
 const url=new URL(request.url);if(request.method!=='POST')throw new ApiError('Método não permitido.',405);
 const maxBody=url.pathname.startsWith('/api/maps/')?65536:4096;
 const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)throw new ApiError('Origem não permitida.',403);
 if(Number(request.headers.get('Content-Length')||0)>maxBody)throw new ApiError('Pedido muito grande.',413);
 const raw=await request.text();if(raw.length>maxBody)throw new ApiError('Pedido muito grande.',413);let body;try{body=JSON.parse(raw);}catch{throw new ApiError('Pedido inválido.');}if(!body||typeof body!=='object')throw new ApiError('Pedido inválido.');
 const db=dbFor(env),action=url.pathname.split('/').pop();
 if(url.pathname.startsWith('/api/maps/'))return json(await customMapsApi(db,action,body));
 if(url.pathname.startsWith('/api/profiles/'))return json(await explorerProfile(db,action,body));
 if(url.pathname.startsWith('/api/leaderboard/'))return json(await globalLeaderboard(db,action,body));
 if(url.pathname.startsWith('/api/global/'))return json(await globalChat(db,action,body));
 if(action==='create'){
  const name=nameOf(body),now=Date.now(),p=newPlayer(name,now),seed=crypto.getRandomValues(new Uint32Array(1))[0],level=body.campaign?PHASE_ORDER[0]:validatedLevel(body.level),mode=validatedMode(body.mode),world=createWorld(seed,level);let code;const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let i=0;i<5;i++){code=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n%alphabet.length]).join('');const room={code,seed,level,mode,campaign:body.campaign===true,world,coinRespawns:{},smile:mode==='hardcore'?{...world.smile}:null,players:[p],host:p.id,status:'lobby',round:0,started:0,lastTick:now,balance:0,collectedCoins:[],fuses:world.fuses.map(()=>false),enemy:{...world.enemy}};const result=await db.prepare('INSERT OR IGNORE INTO rooms(code,state,revision,updated_at) VALUES(?,?,0,?)').bind(code,JSON.stringify(room),now).run();if(result.meta.changes){await db.prepare('DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE updated_at<? LIMIT 30)').bind(now-TTL).run();return json({id:p.id,token:p.token,room:{...safeRoom(room,now),revision:0}});}}throw new ApiError('Não foi possível criar a sala. Tente novamente.',503);
 }
 const code=typeof body.code==='string'?body.code.toUpperCase().trim():'';if(!/^[A-Z2-9]{6}$/.test(code))throw new ApiError('Digite o código de 6 caracteres da sala.');
 if(action==='join'){const name=nameOf(body),p=newPlayer(name,Date.now());return json(await mutate(db,code,(room,now)=>{if(room.status==='won'||room.status==='lost')throw new ApiError('A partida acabou. Peça ao anfitrião para reiniciar.',409);room.players=room.players.filter(p=>now-p.seen<ACTIVE_MS);if(room.players.length>=MAX_PLAYERS)throw new ApiError('Esta sala está cheia (4 jogadores).',409);p.color=colors.find(c=>!room.players.some(v=>v.color===c))||colors[0];room.players.push(p);return {id:p.id,token:p.token};}));}
 if(!['sync','start','leave','revive','level','mode','chat','admin-level'].includes(action))throw new ApiError('Ação não encontrada.',404);
 return json(await mutate(db,code,(room,now)=>{const p=authorize(room,body),previousSeen=p.seen;p.seen=now;
  if(action==='chat'){
   const text=typeof body.text==='string'?body.text.replace(/[\x00-\x1f\x7f]/g,' ').trim():'';
   if(!text||text.length>240)throw new ApiError('Escreva uma mensagem com até 240 caracteres.');
   if(typeof body.messageId!=='string'||!/^[a-zA-Z0-9-]{8,64}$/.test(body.messageId))throw new ApiError('Mensagem inválida.');
   room.messages=room.messages||[];
   if(room.messages.some(m=>m.sender===p.id&&m.clientId===body.messageId))return {};
   if(p.lastChat&&now-p.lastChat<800)throw new ApiError('Espere um instante antes de enviar outra mensagem.',429);
   p.lastChat=now;
   room.messages.push({id:crypto.randomUUID(),clientId:body.messageId,sender:p.id,name:p.name,color:p.color,text,at:now});
   room.messages=room.messages.slice(-50);
   return {};
  }
  if(action==='leave'){room.players=room.players.filter(v=>v.id!==p.id);if(room.host===p.id)room.host=room.players[0]?.id||'';return {};}
  if(room.campaign&&room.status==='won'&&PHASE_ORDER[PHASE_ORDER.indexOf(room.level)+1]&&['start','mode'].includes(action))throw new ApiError('Aguarde a passagem para a próxima fase.',409);
  if(action==='admin-level'){
   if(!adminName(p.name))throw new ApiError('Painel exclusivo do admin.',403);
   const level=body.level==='lurking'?'lurking':validatedLevel(body.level);room.adminUsed=true;room.campaign=false;beginPhase(room,now,level);return {};
  }
  if(action==='revive'){
   if(room.mode==='hardcore'&&!adminName(p.name))throw new ApiError('No Hardcore não é possível reviver.',409);
   if(!['playing','lost'].includes(room.status))throw new ApiError('A expedição precisa estar em andamento.',409);
   const captured=room.players.filter(v=>!v.alive&&now-v.seen<ACTIVE_MS);
   if(!captured.length)throw new ApiError('Todos os exploradores já estão vivos.',409);
   if(!adminName(p.name)&&room.balance<25)throw new ApiError('A equipe precisa de 25 moedas para reviver.',409);
   if(adminName(p.name))room.adminUsed=true;else room.balance-=25;room.status='playing';room.lastTick=now;
   for(const v of captured){v.alive=true;v.x=1.5;v.y=1.5;v.a=0;v.protectedUntil=now+5000;v.moveOrdinal=0;v.moveCredit=.5;v.moveClock=now;v.respawns=(v.respawns||0)+1;}
   return {revived:captured.length};
  }
  if(action==='level'||action==='mode'){
   if(action==='level'&&room.campaign)throw new ApiError('As fases da expedição seguem uma sequência.',409);
   if(room.host!==p.id)throw new ApiError('Somente o anfitrião pode escolher o cenário.',403);
   if(room.status==='playing')throw new ApiError('Escolha o cenário antes de iniciar a partida.',409);
   const level=action==='level'?validatedLevel(body.level):room.level,mode=action==='mode'?validatedMode(body.mode):room.mode;if(level===room.level&&mode===room.mode)return {};room.mode=mode;
   room.level=level;room.world=createWorld(room.seed,level);room.enemy={...room.world.enemy};room.smile=room.mode==='hardcore'?{...room.world.smile}:null;room.status='lobby';room.round++;room.started=0;room.balance=0;room.collectedCoins=[];room.coinRespawns={};room.fuses=room.world.fuses.map(()=>false);
   for(const v of room.players){v.x=1.5;v.y=1.5;v.a=0;v.alive=true;v.seq=0;v.moveOrdinal=0;v.moveCredit=.5;v.moveClock=now;v.respawns=0;v.protectedUntil=0;}
   return {};
  }
  if(action==='start'){if(room.host!==p.id)throw new ApiError('Somente o anfitrião pode iniciar.',403);if(room.status==='playing')return {};if(room.campaign){const level=room.status==='won'&&!PHASE_ORDER[PHASE_ORDER.indexOf(room.level)+1]?PHASE_ORDER[0]:room.level;if(room.status==='won'&&level===PHASE_ORDER[0])room.campaignStarted=now;beginPhase(room,now,level);return {};}room.status='playing';room.started=now;room.lastTick=now;room.round++;room.balance=0;room.collectedCoins=[];room.coinRespawns={};room.fuses=room.world.fuses.map(()=>false);room.enemy={...room.world.enemy};room.smile=room.mode==='hardcore'?{...room.world.smile}:null;for(const v of room.players){v.x=1.5;v.y=1.5;v.a=0;v.alive=true;v.seq=0;v.moveOrdinal=0;v.moveCredit=.5;v.moveClock=now;v.protectedUntil=0;v.respawns=0;}return {};}
  if(room.status==='playing'&&p.alive&&body.round===room.round&&Number.isSafeInteger(body.seq)&&body.seq>p.seq){p.seq=body.seq;const movement=validateMovement(room,p,body,now,previousSeen),accepted=movement.accepted;
  if(room.mode!=='hardcore')for(const coin of room.world.coins)if(!room.collectedCoins.includes(coin.id)&&distance(p,coin)<.55){room.collectedCoins.push(coin.id);room.coinRespawns[coin.id]=now+10000;room.balance++;}
  for(let i=0;i<room.world.fuses.length;i++)if(distance(p,room.world.fuses[i])<.7)room.fuses[i]=true;
  if(now-room.started>(room.level==='run'?6000:22000)&&now>=(p.protectedUntil||0)&&(distance(p,room.enemy)<.43||(room.mode==='hardcore'&&distance(p,room.smile)<.43)))p.alive=false;
  if(p.alive&&room.fuses.every(Boolean)&&distance(p,room.world.exit)<.7)room.status='won';
  if(!room.players.some(v=>v.alive&&now-v.seen<ACTIVE_MS))room.status='lost';
  return {positionAccepted:accepted,movementReason:movement.reason||null,ackMovement:movement.ackMovement};}
  return {};
 }));
 }catch(error){if(!(error instanceof ApiError))console.error('Room API failure',error);return json({error:error instanceof ApiError?error.message:'A conexão com a sala falhou. Tente novamente.'},error.status||503);}
}
export default {async fetch(request,env){const path=new URL(request.url).pathname;if(path.startsWith('/api/'))return api(request,env);const file=ASSETS[path==='/'?'/index.html':path];if(!file)return new Response('Não encontrado',{status:404});return new Response(file.body,{headers:{'Content-Type':file.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});}};
