// Copia o painel (apps/admin) para public/admin, de onde o Worker o serve em /admin/.
import { cpSync, rmSync } from 'node:fs';

rmSync('public/admin', { recursive: true, force: true });
cpSync('apps/admin', 'public/admin', { recursive: true });
