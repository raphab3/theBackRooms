// Protocolo WebSocket da sala (Fase 0, JSON). Cliente e servidor importam daqui:
// os tipos e a validação existem uma vez só.
// Só usa sintaxe TypeScript "apagável" (sem enum/namespace) para rodar direto no Node 24.

/** Sobe a cada mudança incompatível; o servidor recusa `hello` com outra versão. */
export const PROTOCOL_VERSION = 1;
/** Limite do texto bruto vindo do cliente (bate com o corpo máximo da API REST). */
export const MAX_CLIENT_MESSAGE = 4096;
/** `welcome` carrega a sala inteira (até 50 mensagens de chat), então o limite é maior. */
export const MAX_SERVER_MESSAGE = 65536;
export const MAX_PLAYERS = 4;
export const MAX_CHAT_LENGTH = 240;
/** Mesmo limite de ângulo que `validateMovement` usa hoje no servidor. */
export const MAX_ANGLE = 1e8;

export const ACTION_KINDS = ['start', 'revive', 'level', 'mode', 'chat', 'leave'] as const;
export const GAME_MODES = ['normal', 'hardcore'] as const;
export const ROOM_STATUSES = ['lobby', 'playing', 'won', 'lost'] as const;
export const ANIMATIONS = ['idle', 'walk', 'run', 'dead'] as const;
export const EVENT_KINDS = ['coin', 'death', 'phase', 'chat'] as const;
export const ERROR_CODES = ['version', 'invalid', 'auth', 'forbidden', 'rate', 'room'] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type GameMode = (typeof GAME_MODES)[number];
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export type Animation = (typeof ANIMATIONS)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------- Cliente → servidor ----------

export interface HelloMessage {
  t: 'hello';
  v: number;
  token: string;
}

/** Intenção de movimento: dx/dy em [-1, 1] no referencial do jogador; `a` é o ângulo atual. */
export interface InputMessage {
  t: 'input';
  seq: number;
  dx: number;
  dy: number;
  a: number;
  run: boolean;
  light: boolean;
}

export type ActionMessage =
  | { t: 'action'; kind: 'start' | 'revive' | 'leave' }
  | { t: 'action'; kind: 'level'; level: string }
  | { t: 'action'; kind: 'mode'; mode: GameMode }
  | { t: 'action'; kind: 'chat'; text: string; messageId: string };

export type ClientMessage = HelloMessage | InputMessage | ActionMessage;

// ---------- Servidor → cliente ----------

export interface Point {
  x: number;
  y: number;
}

export interface RoomPlayer extends Point {
  id: string;
  name: string;
  color: string;
  a: number;
  alive: boolean;
  respawns: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  name: string;
  color: string;
  text: string;
  at: number;
}

/** Estado completo da sala (mesmo conteúdo que `safeRoom` devolve hoje). */
export interface RoomState {
  code: string;
  level: string;
  mode: GameMode;
  campaign: boolean;
  campaignStarted: number;
  adminUsed: boolean;
  seed: number;
  host: string;
  status: RoomStatus;
  round: number;
  started: number;
  finished: number;
  now: number;
  fuses: boolean[];
  balance: number;
  collectedCoins: number[];
  enemy: Point;
  smile: Point | null;
  players: RoomPlayer[];
  messages: ChatMessage[];
  capacity: number;
}

export interface WelcomeMessage {
  t: 'welcome';
  v: number;
  id: string;
  room: RoomState;
}

export interface SnapshotPlayer extends Point {
  id: string;
  a: number;
  anim: Animation;
  alive: boolean;
}

export interface SnapshotMessage {
  t: 'snapshot';
  tick: number;
  players: SnapshotPlayer[];
  enemy: Point;
  smile: Point | null;
  fuses: boolean[];
  coins: { balance: number; collected: number[] };
}

export type EventMessage =
  | { t: 'event'; kind: 'coin'; playerId: string; coinId: number; balance: number }
  | { t: 'event'; kind: 'death'; playerId: string }
  | { t: 'event'; kind: 'phase'; level: string; status: RoomStatus }
  | { t: 'event'; kind: 'chat'; message: ChatMessage };

export interface ErrorMessage {
  t: 'error';
  code: ErrorCode;
  message: string;
}

export type ServerMessage = WelcomeMessage | SnapshotMessage | EventMessage | ErrorMessage;

export type DecodeResult<T> =
  { ok: true; msg: T } | { ok: false; code: 'invalid' | 'version'; error: string };

// ---------- Validação ----------

class ProtocolError extends Error {
  code: 'invalid' | 'version';
  constructor(message: string, code: 'invalid' | 'version' = 'invalid') {
    super(message);
    this.code = code;
  }
}

type Obj = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new ProtocolError(`Campo "${path}" inválido: esperado ${expected}.`);
}
function obj(value: unknown, path: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'objeto');
  return value as Obj;
}
function num(o: Obj, key: string, min: number, max: number, path = key): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail(path, `número entre ${min} e ${max}`);
  return v;
}
function int(o: Obj, key: string, min = 0, max = Number.MAX_SAFE_INTEGER, path = key): number {
  const v = num(o, key, min, max, path);
  if (!Number.isSafeInteger(v)) fail(path, 'inteiro');
  return v;
}
function bool(o: Obj, key: string, path = key): boolean {
  if (typeof o[key] !== 'boolean') fail(path, 'booleano');
  return o[key] as boolean;
}
function str(o: Obj, key: string, min: number, max: number, path = key, re?: RegExp): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length < min || v.length > max || (re && !re.test(v)))
    fail(path, `texto com ${min} a ${max} caracteres`);
  return v;
}
function oneOf<T extends string>(o: Obj, key: string, list: readonly T[], path = key): T {
  const v = o[key];
  if (!list.includes(v as T)) fail(path, list.join(' | '));
  return v as T;
}
function list<T>(o: Obj, key: string, max: number, item: (v: unknown, path: string) => T): T[] {
  const v = o[key];
  if (!Array.isArray(v) || v.length > max) fail(key, `lista com até ${max} itens`);
  return v.map((x, i) => item(x, `${key}[${i}]`));
}
function point(value: unknown, path: string): Point {
  const o = obj(value, path);
  return { x: num(o, 'x', 0, 1024, path + '.x'), y: num(o, 'y', 0, 1024, path + '.y') };
}
const ID = /^[a-zA-Z0-9-]{1,64}$/;
const LEVEL = /^[a-z0-9-]{1,32}$/;
const MESSAGE_ID = /^[a-zA-Z0-9-]{8,64}$/;
const coinId = (v: unknown, path: string) => int({ v }, 'v', 0, 10000, path);
const fuse = (v: unknown, path: string) => bool({ v }, 'v', path);

function chatMessage(value: unknown, path: string): ChatMessage {
  const o = obj(value, path);
  return {
    id: str(o, 'id', 1, 64, path + '.id'),
    sender: str(o, 'sender', 1, 64, path + '.sender'),
    name: str(o, 'name', 1, 64, path + '.name'),
    color: str(o, 'color', 1, 32, path + '.color'),
    text: str(o, 'text', 1, MAX_CHAT_LENGTH, path + '.text'),
    at: int(o, 'at', 0, undefined, path + '.at'),
  };
}
function roomPlayer(value: unknown, path: string): RoomPlayer {
  const o = obj(value, path);
  return {
    id: str(o, 'id', 1, 64, path + '.id', ID),
    name: str(o, 'name', 1, 64, path + '.name'),
    color: str(o, 'color', 1, 32, path + '.color'),
    ...point(o, path),
    a: num(o, 'a', -MAX_ANGLE, MAX_ANGLE, path + '.a'),
    alive: bool(o, 'alive', path + '.alive'),
    respawns: int(o, 'respawns', 0, undefined, path + '.respawns'),
  };
}
function snapshotPlayer(value: unknown, path: string): SnapshotPlayer {
  const o = obj(value, path);
  return {
    id: str(o, 'id', 1, 64, path + '.id', ID),
    ...point(o, path),
    a: num(o, 'a', -MAX_ANGLE, MAX_ANGLE, path + '.a'),
    anim: oneOf(o, 'anim', ANIMATIONS, path + '.anim'),
    alive: bool(o, 'alive', path + '.alive'),
  };
}
function roomState(value: unknown): RoomState {
  const o = obj(value, 'room');
  const p = (k: string) => 'room.' + k;
  return {
    code: str(o, 'code', 6, 6, p('code'), /^[A-Z2-9]{6}$/),
    level: str(o, 'level', 1, 32, p('level'), LEVEL),
    mode: oneOf(o, 'mode', GAME_MODES, p('mode')),
    campaign: bool(o, 'campaign', p('campaign')),
    campaignStarted: int(o, 'campaignStarted', 0, undefined, p('campaignStarted')),
    adminUsed: bool(o, 'adminUsed', p('adminUsed')),
    seed: int(o, 'seed', 0, 0xffffffff, p('seed')),
    host: str(o, 'host', 0, 64, p('host')),
    status: oneOf(o, 'status', ROOM_STATUSES, p('status')),
    round: int(o, 'round', 0, undefined, p('round')),
    started: int(o, 'started', 0, undefined, p('started')),
    finished: int(o, 'finished', 0, undefined, p('finished')),
    now: int(o, 'now', 0, undefined, p('now')),
    fuses: list(o, 'fuses', 32, fuse),
    balance: int(o, 'balance', 0, undefined, p('balance')),
    collectedCoins: list(o, 'collectedCoins', 1000, coinId),
    enemy: point(o.enemy, p('enemy')),
    smile: o.smile === null ? null : point(o.smile, p('smile')),
    players: list(o, 'players', MAX_PLAYERS, roomPlayer),
    messages: list(o, 'messages', 50, chatMessage),
    capacity: int(o, 'capacity', 1, MAX_PLAYERS, p('capacity')),
  };
}

function clientMessage(o: Obj): ClientMessage {
  switch (o.t) {
    case 'hello': {
      const v = int(o, 'v', 0);
      if (v !== PROTOCOL_VERSION)
        throw new ProtocolError(
          `Versão do jogo incompatível (cliente v${v}, servidor v${PROTOCOL_VERSION}). Atualize a página.`,
          'version',
        );
      return { t: 'hello', v, token: str(o, 'token', 1, 128) };
    }
    case 'input':
      return {
        t: 'input',
        seq: int(o, 'seq'),
        dx: num(o, 'dx', -1, 1),
        dy: num(o, 'dy', -1, 1),
        a: num(o, 'a', -MAX_ANGLE, MAX_ANGLE),
        run: bool(o, 'run'),
        light: bool(o, 'light'),
      };
    case 'action': {
      const kind = oneOf(o, 'kind', ACTION_KINDS);
      if (kind === 'level')
        return { t: 'action', kind, level: str(o, 'level', 1, 32, 'level', LEVEL) };
      if (kind === 'mode') return { t: 'action', kind, mode: oneOf(o, 'mode', GAME_MODES) };
      if (kind === 'chat') {
        const text = str(o, 'text', 1, MAX_CHAT_LENGTH);
        if (!text.trim()) fail('text', 'mensagem não vazia');
        return {
          t: 'action',
          kind,
          text,
          messageId: str(o, 'messageId', 8, 64, 'messageId', MESSAGE_ID),
        };
      }
      return { t: 'action', kind };
    }
    default:
      return fail('t', 'hello | input | action');
  }
}

function serverMessage(o: Obj): ServerMessage {
  switch (o.t) {
    case 'welcome':
      return {
        t: 'welcome',
        v: int(o, 'v'),
        id: str(o, 'id', 1, 64, 'id', ID),
        room: roomState(o.room),
      };
    case 'snapshot': {
      const coins = obj(o.coins, 'coins');
      return {
        t: 'snapshot',
        tick: int(o, 'tick'),
        players: list(o, 'players', MAX_PLAYERS, snapshotPlayer),
        enemy: point(o.enemy, 'enemy'),
        smile: o.smile === null ? null : point(o.smile, 'smile'),
        fuses: list(o, 'fuses', 32, fuse),
        coins: {
          balance: int(coins, 'balance', 0, undefined, 'coins.balance'),
          collected: list(coins, 'collected', 1000, coinId),
        },
      };
    }
    case 'event': {
      const kind = oneOf(o, 'kind', EVENT_KINDS);
      if (kind === 'coin')
        return {
          t: 'event',
          kind,
          playerId: str(o, 'playerId', 1, 64, 'playerId', ID),
          coinId: int(o, 'coinId', 0, 10000),
          balance: int(o, 'balance'),
        };
      if (kind === 'death')
        return { t: 'event', kind, playerId: str(o, 'playerId', 1, 64, 'playerId', ID) };
      if (kind === 'phase')
        return {
          t: 'event',
          kind,
          level: str(o, 'level', 1, 32, 'level', LEVEL),
          status: oneOf(o, 'status', ROOM_STATUSES),
        };
      return { t: 'event', kind, message: chatMessage(o.message, 'message') };
    }
    case 'error':
      return {
        t: 'error',
        code: oneOf(o, 'code', ERROR_CODES),
        message: str(o, 'message', 1, 500),
      };
    default:
      return fail('t', 'welcome | snapshot | event | error');
  }
}

function decodeWith<T>(raw: unknown, max: number, parse: (o: Obj) => T): DecodeResult<T> {
  try {
    if (typeof raw !== 'string') fail('mensagem', 'texto JSON');
    if (raw.length > max) fail('mensagem', `até ${max} caracteres`);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      fail('mensagem', 'JSON válido');
    }
    // Devolve uma cópia só com os campos conhecidos: extras são descartados.
    return { ok: true, msg: parse(obj(data, 'mensagem')) };
  } catch (e) {
    if (e instanceof ProtocolError) return { ok: false, code: e.code, error: e.message };
    throw e;
  }
}

/** Servidor: valida o que chegou do cliente. `code: 'version'` → responder `error` e fechar. */
export function decodeClientMessage(raw: unknown): DecodeResult<ClientMessage> {
  return decodeWith(raw, MAX_CLIENT_MESSAGE, clientMessage);
}

/** Cliente: valida o que chegou do servidor. */
export function decodeServerMessage(raw: unknown): DecodeResult<ServerMessage> {
  return decodeWith(raw, MAX_SERVER_MESSAGE, serverMessage);
}

/** Serializa validando antes; lança erro se a mensagem estiver fora do protocolo. */
export function encode(msg: ClientMessage | ServerMessage): string {
  const o = msg as unknown as Obj;
  const isClient = o.t === 'hello' || o.t === 'input' || o.t === 'action';
  const clean = isClient ? clientMessage(o) : serverMessage(o);
  return JSON.stringify(clean);
}
