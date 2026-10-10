// Copia o painel (apps/admin) para apps/game/dist/admin, de onde o Worker o serve em /admin/.
import { cpSync, rmSync } from 'node:fs';

rmSync('apps/game/dist/admin', { recursive: true, force: true });
cpSync('apps/admin', 'apps/game/dist/admin', {
  recursive: true,
  filter: src => !src.endsWith('package.json'),
});
