// Copia o painel (apps/admin) para apps/game/public/admin (o Vite leva para o dist), de onde o Worker o serve em /admin/.
import { cpSync, rmSync } from 'node:fs';

rmSync('apps/game/public/admin', { recursive: true, force: true });
cpSync('apps/admin', 'apps/game/public/admin', { recursive: true });
