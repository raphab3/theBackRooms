# Learnings do workspace

Memória operacional reutilizável (cross-spec). **Não** substitui ADR formal nem `context.md` da spec.

| Artefato | Onde | Papel |
|----------|------|-------|
| context.md | por spec | Decisões do discuss |
| DC-xx | design.md da spec | Trade-off desta feature |
| L-xxx | este arquivo | Preferência / anti-padrão reutilizável |
| ADR | `.specgate/docs/adrs/` | Decisão arquitetural formal |

## Quando escrever (soft — não hard gate)

Criar um L-xxx **não** é obrigatório ao marcar task `done`. Preferir append quando:

- Fechar investigação (`run_investigation` / closeout) com regra reutilizável
- Bug/regressão recorrente ou “já vimos isso”
- Fix estilo incidente (root cause + prevenção)
- DC aprovada com `Promover a learning?: sim`

Uma learning = **uma** lição curta. Formato abaixo é **obrigatório** se o item for escrito.

Formato canônico (retrieval-friendly para MemoryStore lexical):

```markdown
## L-0XX — <título com termos canônicos>
**Quando:** <sintoma / situação>
**Faça:** <regra acionável>
**Não faça:** <anti-padrão>
**Termos:** comma-separated (L0, tokenBudget, SecretVault, graph_action, …)
**Refs:** TASK-… / spec ids / paths
**Status:** ativo | superado
```

`Termos` deve repetir keywords que agentes realmente buscam (MCP tools, símbolos, nomes de produto). `Status` opcional no texto novo — default implícito `ativo`; use `superado` para aposentar.

Legado (ainda parseado): `- Quando:` / `- Decisão:` / `- Evitar:` / `- Origem:` — preferir o formato canônico em entradas novas.

---

## L-001 — Preferir escalate antes de task multi-PR
**Quando:** task toca >1 sistema / claramente >1 PR / precisa de design antes de código
**Faça:** escalar para spec (`escalate_task_to_spec` com confirmação) e seguir SDD
**Não faça:** “só mais um arquivo” até virar monólito na mesma task
**Termos:** escalate_task_to_spec, multi-PR, SDD, spec, task scope
**Refs:** sdd-development-harness / DC-exemplo
**Status:** ativo

## L-002 — Guidance first; hard gates só onde já existem
**Quando:** tentação de bloquear refine/tasks/status por checklist novo
**Faça:** skill + templates + soft signals; pipeline lint/typecheck/build/test permanece o gate duro
**Não faça:** status machine de 6 fases ou cobertura % como hard gate universal; exigir learning em todo `done`
**Termos:** soft signal, hard gate, run_project_pipeline, review, done, learnings
**Refs:** sdd-development-harness
**Status:** ativo
