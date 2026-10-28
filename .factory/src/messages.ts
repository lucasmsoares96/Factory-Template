/**
 * The fixed texts the Factory publishes (comments, pull request bodies, Skeleton issues), in every language of
 * `FACTORY_LANGUAGE`. Contract text stays in English in every language, because the Factory and people search for it:
 * the headings `## Acceptance criteria`, `## Testing Decisions` and `## Evidence`, the title "The Skeleton must grow",
 * the Factory markers, the pull request title and the Stage names. A key without one of the languages fails a test.
 */

import type { RetroCandidate } from "./retro-output.ts";

export const LANGUAGES = ["en", "pt-BR"] as const;
export type Language = (typeof LANGUAGES)[number];

/** How the prompts name the language the agent writes public text in. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", "pt-BR": "Brazilian Portuguese (pt-BR)" };

type Text = (...args: never[]) => string;

/** One text in every language; `en` is the fallback the type requires, the test requires the others. */
function text<F extends Text>(translations: { en: F } & Partial<Record<Language, F>>) {
  return translations;
}

const list = (paths: string[]) => paths.map((p) => `\`${p}\``).join(", ");

export const catalog = {
  // The guard's refusals, answered by `claim`.
  missingCriteria: text({
    en: (ready: string) => `The Factory needs a \`## Acceptance criteria\` section in the issue body. Add it and re-add \`${ready}\`.`,
    "pt-BR": (ready) => `A Factory precisa de uma seção \`## Acceptance criteria\` no corpo da issue. Adicione-a e coloque \`${ready}\` de novo.`,
  }),
  missingSeams: text({
    en: (): string => "No agreed seams: the parent spec has no `## Testing Decisions` and there is no Triage comment. Sent to Triage.",
    "pt-BR": () => "Sem seams combinados: a spec pai não tem `## Testing Decisions` e não há comentário da Triage. Enviada para a Triage.",
  }),
  waitingOn: text({
    en: (list: string, ready: string) =>
      `Waiting on ${list}. The Factory starts this issue when the last of them is done.\nIf you remove a dependency, remove and re-add \`${ready}\` to start right away.`,
    "pt-BR": (list, ready) =>
      `Aguardando ${list}. A Factory começa esta issue quando a última delas for concluída.\nSe você remover uma dependência, remova e coloque \`${ready}\` de novo para começar já.`,
  }),

  // The Escalation comment.
  escalationTitle: text({
    en: (reason: string, headline: string) => `**Factory escalation (\`${reason}\`):** ${headline}`,
    "pt-BR": (reason, headline) => `**Escalation da Factory (\`${reason}\`):** ${headline}`,
  }),
  headlineTime: text({
    en: (minutes: number) => `The run hit the global time limit of ${minutes} min.`,
    "pt-BR": (minutes) => `A execução atingiu o limite global de tempo de ${minutes} min.`,
  }),
  headlineNeedsHuman: text({
    en: (): string => "Development needs a human decision.",
    "pt-BR": () => "O Development precisa de uma decisão humana.",
  }),
  headlineInfra: text({
    en: (): string => "The work job left no valid result (infrastructure failure).",
    "pt-BR": () => "O job work não deixou um resultado válido (falha de infraestrutura).",
  }),
  headlineE2e: text({
    en: (count: number) => `E2E did not pass in ${count} attempts.`,
    "pt-BR": (count) => `O E2E não passou em ${count} tentativas.`,
  }),
  headlineAttempts: text({
    en: (count: number, stage: string, noCommits: boolean, outcome: string) =>
      `The attempt limit was reached after ${count} attempts without a passing E2E; the last one stopped at ${stage}, which ${noCommits ? "made no commits" : `ended with ${outcome}`}.`,
    "pt-BR": (count, stage, noCommits, outcome) =>
      `O limite de tentativas foi atingido após ${count} tentativas sem um E2E verde; a última parou no ${stage}, que ${noCommits ? "não fez commits" : `terminou com ${outcome}`}.`,
  }),
  headlineCriteriaUnmet: text({
    en: (): string => "The Review found acceptance criteria that are not met.",
    "pt-BR": () => "A Review encontrou critérios de aceitação que não foram atendidos.",
  }),
  criteriaUnmet: text({ en: (): string => "**Criteria not met**", "pt-BR": () => "**Critérios não atendidos**" }),
  question: text({ en: (question: string) => `**Question:** ${question}`, "pt-BR": (question) => `**Pergunta:** ${question}` }),
  attempts: text({ en: (): string => "**Attempts**", "pt-BR": () => "**Tentativas**" }),
  pullRequestStageLine: text({
    en: (outcome: string) => `- Pull Request Stage (not an attempt): ${outcome}`,
    "pt-BR": (outcome) => `- Pull Request Stage (não é uma tentativa): ${outcome}`,
  }),
  lastOutput: text({
    en: (command: string | null) => `**Last output**${command ? ` (\`${command}\`)` : ""}, truncated:`,
    "pt-BR": (command) => `**Última saída**${command ? ` (\`${command}\`)` : ""}, truncada:`,
  }),
  draftPullRequest: text({ en: (pr: number) => `**Pull request:** #${pr} (draft)`, "pt-BR": (pr) => `**Pull request:** #${pr} (rascunho)` }),
  noPullRequest: text({
    en: (): string => "**Pull request:** No pull request: the run made no commits.",
    "pt-BR": () => "**Pull request:** Nenhum pull request: a execução não fez commits.",
  }),
  workflowRun: text({ en: (url: string) => `**Workflow run:** ${url}`, "pt-BR": (url) => `**Execução do workflow:** ${url}` }),
  retry: text({
    en: (ready: string, base: string) => `To try again, re-add the \`${ready}\` label: the Factory closes the draft pull request and starts over from \`${base}\`.`,
    "pt-BR": (ready, base) => `Para tentar de novo, coloque o label \`${ready}\` outra vez: a Factory fecha o pull request rascunho e recomeça a partir de \`${base}\`.`,
  }),

  // The attempt lines and the token/cost footer.
  attemptLine: text({ en: (n: number, stages: string) => `Attempt ${n}: ${stages}`, "pt-BR": (n, stages) => `Tentativa ${n}: ${stages}` }),
  commits: text({ en: (n: number) => `${n} ${n === 1 ? "commit" : "commits"}`, "pt-BR": (n) => `${n} ${n === 1 ? "commit" : "commits"}` }),
  outcomeFailed: text({ en: (command: string) => `failed: \`${command}\``, "pt-BR": (command) => `falhou: \`${command}\`` }),
  outcomeNoCommits: text({ en: (): string => "no commits", "pt-BR": () => "sem commits" }),
  outcomeTimeout: text({ en: (): string => "timeout", "pt-BR": () => "tempo esgotado" }),
  outcomeNeedsHuman: text({ en: (): string => "needs a human", "pt-BR": () => "precisa de uma pessoa" }),
  usage: text({
    en: (input: string, output: string, cost: string) => `Tokens: ${input} in / ${output} out. Estimated cost: $${cost}.`,
    "pt-BR": (input, output, cost) => `Tokens: ${input} de entrada / ${output} de saída. Custo estimado: US$ ${cost}.`,
  }),
  pullRequestStageNote: text({
    en: (outcome: "skipped" | "timeout" | "failed", reason: string) =>
      ` The Pull Request Stage ${outcome === "skipped" ? "did not run" : outcome === "timeout" ? "timed out" : "failed"}: ${reason}; the pull request has the minimal body.`,
    "pt-BR": (outcome, reason) =>
      ` A Pull Request Stage ${outcome === "skipped" ? "não rodou" : outcome === "timeout" ? "estourou o tempo" : "falhou"}: ${reason}; o pull request tem o corpo mínimo.`,
  }),
  noReason: text({ en: (): string => "no reason recorded", "pt-BR": () => "nenhum motivo registrado" }),

  // The Skeleton follow-ups: the note on the issue and the pull request, the wait, the Skeleton issue and pull request.
  followUpIntro: text({
    en: (): string => "**The Skeleton must grow.** A Product issue never changes `packages/skeleton/`, so the Factory removed that change from this work and opened:",
    "pt-BR": () => "**The Skeleton must grow.** Uma issue de Product nunca altera `packages/skeleton/`, então a Factory tirou essa mudança deste trabalho e abriu:",
  }),
  followUpItem: text({
    en: (number: number, title: string, pr: number | null) => `- #${number} ${title}${pr !== null ? `, with pull request #${pr} ready for review` : ""}`,
    "pt-BR": (number, title, pr) => `- #${number} ${title}${pr !== null ? `, com o pull request #${pr} pronto para revisão` : ""}`,
  }),
  waitingOnSkeleton: text({
    en: (blockers: string, ready: string, base: string, one: boolean) =>
      `The acceptance criteria cannot be met without that change, so this issue is now blocked by ${blockers} and back in \`${ready}\`. When ${one ? "it is" : "they are"} closed, the Factory starts again from \`${base}\`, which will have the new Skeleton.`,
    "pt-BR": (blockers, ready, base, one) =>
      `Os critérios de aceitação não podem ser cumpridos sem essa mudança, então esta issue agora está bloqueada por ${blockers} e de volta em \`${ready}\`. Quando ${one ? "ela for fechada" : "elas forem fechadas"}, a Factory recomeça a partir de \`${base}\`, que terá o novo Skeleton.`,
  }),
  followUpBodyIntro: text({
    en: (product: string, path: string, number: number, title: string) => `The Skeleton must grow: Product \`${product}\` needs a change in \`${path}\` to finish #${number} (${title}).`,
    "pt-BR": (product, path, number, title) => `The Skeleton must grow: o Product \`${product}\` precisa de uma mudança em \`${path}\` para concluir #${number} (${title}).`,
  }),
  followUpBodyRemoved: text({
    en: (withPullRequest: boolean): string =>
      withPullRequest
        ? "A Product extends the Skeleton by configuration only, so the Factory removed this change from the Product pull request and opened it as a pull request of its own, from the base branch: review and merge it to close this issue."
        : "A Product extends the Skeleton by configuration only, so the Factory removed this change from the Product pull request.",
    "pt-BR": (withPullRequest) =>
      withPullRequest
        ? "Um Product só estende o Skeleton por configuração, então a Factory tirou esta mudança do pull request do Product e a abriu num pull request próprio, a partir do branch base: revise e faça o merge dele para fechar esta issue."
        : "Um Product só estende o Skeleton por configuração, então a Factory tirou esta mudança do pull request do Product.",
  }),
  gapsHeading: text({ en: (): string => "## What the Skeleton must offer", "pt-BR": () => "## O que o Skeleton precisa oferecer" }),
  followUpFilesHeading: text({
    en: (): string => "## Files the Product run changed (removed from its branch)",
    "pt-BR": () => "## Arquivos que a execução do Product alterou (removidos do branch dela)",
  }),
  followUpCriterion: text({
    en: (): string => "- [ ] The Skeleton exposes what the Product needs, through its interface (grown in a separate change).",
    "pt-BR": () => "- [ ] O Skeleton expõe o que o Product precisa, pela sua interface (ampliada numa mudança separada).",
  }),
  skeletonPullRequestIntro: text({
    en: (number: number, title: string, path: string, base: string) =>
      `Product issue #${number} (${title}) needs this change in \`${path}\`. A Product issue never changes the Skeleton, so the Factory took it out of that run and opened it here, from \`${base}\`, as the run wrote it. Review it as a change to the Skeleton.`,
    "pt-BR": (number, title, path, base) =>
      `A issue de Product #${number} (${title}) precisa desta mudança em \`${path}\`. Uma issue de Product nunca altera o Skeleton, então a Factory a tirou daquela execução e a abriu aqui, a partir de \`${base}\`, como a execução a escreveu. Revise-a como uma mudança no Skeleton.`,
  }),
  filesHeading: text({ en: (): string => "## Files", "pt-BR": () => "## Arquivos" }),

  // The pull request body: the warnings and the minimal text.
  escalatedDraft: text({
    en: (reason: string, issue: number) => `The Factory escalated this work (\`${reason}\`): this draft holds its progress. See the comment on #${issue}.`,
    "pt-BR": (reason, issue) => `A Factory fez a Escalation deste trabalho (\`${reason}\`): este rascunho guarda o progresso. Veja o comentário em #${issue}.`,
  }),
  sensitiveFiles: text({
    en: (paths: string[]) =>
      `This pull request changes sensitive files: ${list(paths)}. A workflow runs with the repository's secrets, and skills, \`.claude/\` and \`.mcp.json\` steer every agent: read them line by line before merging.`,
    "pt-BR": (paths) =>
      `Este pull request altera arquivos sensíveis: ${list(paths)}. Um workflow roda com os secrets do repositório, e as skills, \`.claude/\` e \`.mcp.json\` guiam todo agente: leia-os linha a linha antes do merge.`,
  }),
  harnessFiles: text({
    en: (paths: string[]) => `This pull request changes files that steer the Factory: ${list(paths)}. Review them with care.`,
    "pt-BR": (paths) => `Este pull request altera arquivos que guiam a Factory: ${list(paths)}. Revise-os com cuidado.`,
  }),
  // `merge`: the comment on a pull request the Factory merged on its own (Merge Mode).
  autoMerged: text({
    en: (mode: string, base: string, preview: boolean, protectedFiles: string[]) =>
      [
        `The Factory merged this pull request on its own: the Merge Mode is \`${mode}\`, and every condition held.`,
        "",
        mode === "all"
          ? `- The Merge Mode \`all\` merges protected files too (\`PROTECTED_PATHS\` in \`.factory/src/config.ts\`)${protectedFiles.length > 0 ? `; this diff changes ${list(protectedFiles)}` : ""}.`
          : "- No file of the diff is protected (`PROTECTED_PATHS` in `.factory/src/config.ts`).",
        "- `verify` passed.",
        preview ? "- No preview deploy or smoke failed." : "- This pull request has no preview to smoke.",
        "- Every acceptance criterion has a met verdict.",
        `- The last deploy of \`${base}\` did not fail.`,
        "",
        "To undo it, revert the merge commit.",
      ].join("\n"),
    "pt-BR": (mode, base, preview, protectedFiles) =>
      [
        `A Factory fez o merge deste pull request sozinha: o Merge Mode é \`${mode}\`, e todas as condições valeram.`,
        "",
        mode === "all"
          ? `- O Merge Mode \`all\` faz o merge de arquivos protegidos também (\`PROTECTED_PATHS\` em \`.factory/src/config.ts\`)${protectedFiles.length > 0 ? `; este diff altera ${list(protectedFiles)}` : ""}.`
          : "- Nenhum arquivo do diff é protegido (`PROTECTED_PATHS` em `.factory/src/config.ts`).",
        "- O `verify` passou.",
        preview ? "- Nenhum deploy ou smoke de preview falhou." : "- Este pull request não tem preview para o smoke.",
        "- Todo critério de aceitação tem veredito atendido.",
        `- O último deploy da \`${base}\` não falhou.`,
        "",
        "Para desfazer, reverta o commit de merge.",
      ].join("\n"),
  }),
  verdictsHeading: text({ en: (): string => "## Acceptance criteria verdicts", "pt-BR": () => "## Vereditos dos critérios de aceitação" }),
  minimalBody: text({ en: (): string => "Implemented by the Factory.", "pt-BR": () => "Implementado pela Factory." }),
  noFindings: text({ en: (): string => "No findings.", "pt-BR": () => "Nenhum achado." }),

  // The other comments of `publish`.
  discarded: text({ en: (reason: string) => `Run discarded: ${reason}. Nothing was pushed.`, "pt-BR": (reason) => `Execução descartada: ${reason}. Nada foi enviado.` }),
  issueClosed: text({ en: (issue: number) => `issue #${issue} is closed`, "pt-BR": (issue) => `a issue #${issue} está fechada` }),
  issueUnlocked: text({ en: (issue: number, label: string) => `issue #${issue} no longer has \`${label}\``, "pt-BR": (issue, label) => `a issue #${issue} não tem mais \`${label}\`` }),
  pullRequestGone: text({ en: (pr: number) => `pull request #${pr} is no longer open`, "pt-BR": (pr) => `o pull request #${pr} não está mais aberto` }),
  pullRequestOpen: text({
    en: (pr: number) => `pull request #${pr} is already open for this issue`,
    "pt-BR": (pr) => `o pull request #${pr} já está aberto para esta issue`,
  }),
  branchMoved: text({ en: (branch: string) => `branch ${branch} moved since the run started`, "pt-BR": (branch) => `o branch ${branch} mudou desde o início da execução` }),
  superseded: text({
    en: (issue: number, base: string) => `Superseded by a new Factory run for #${issue}, which starts over from \`${base}\`.`,
    "pt-BR": (issue, base) => `Substituído por uma nova execução da Factory para #${issue}, que recomeça a partir de \`${base}\`.`,
  }),
  roundEscalated: text({
    en: (reason: string, issue: number, label: string) =>
      `The Factory could not finish this round (\`${reason}\`). Issue #${issue} is now \`${label}\`: the comment there has the attempts. This pull request stays as it is.`,
    "pt-BR": (reason, issue, label) =>
      `A Factory não conseguiu terminar esta rodada (\`${reason}\`). A issue #${issue} agora está em \`${label}\`: o comentário lá tem as tentativas. Este pull request fica como está.`,
  }),
  decision: text({
    en: (decision: "address" | "decline" | "defer" | "answer"): string => ({ address: "Address", decline: "Decline", defer: "Defer", answer: "Answer" })[decision],
    "pt-BR": (decision) => ({ address: "Atendido", decline: "Recusado", defer: "Adiado", answer: "Resposta" })[decision],
  }),
  quoted: text({
    en: (author: string, review: boolean) => `**${author}** ${review ? "reviewed" : "wrote"}:`,
    "pt-BR": (author, review) => `**${author}** ${review ? "revisou" : "escreveu"}:`,
  }),

  // The update of a pull request with the base branch.
  updateNoResult: text({
    en: (base: string, detail: string) => `The Factory could not update this branch with \`${base}\`: the work job left no valid result (${detail}). Nothing was pushed.`,
    "pt-BR": (base, detail) => `A Factory não conseguiu atualizar este branch com \`${base}\`: o job work não deixou um resultado válido (${detail}). Nada foi enviado.`,
  }),
  updateStopped: text({
    en: (base: string, reason: string) => `The Factory could not update this branch with \`${base}\` (\`${reason}\`), so it pushed nothing and stopped.`,
    "pt-BR": (base, reason) => `A Factory não conseguiu atualizar este branch com \`${base}\` (\`${reason}\`), então não enviou nada e parou.`,
  }),
  updated: text({
    en: (base: string, baseSha: string, head: string) => `Merged \`${base}\` (\`${baseSha}\`) into this branch and pushed \`${head}\`.`,
    "pt-BR": (base, baseSha, head) => `Fez o merge de \`${base}\` (\`${baseSha}\`) neste branch e enviou \`${head}\`.`,
  }),
  updateFixed: text({
    en: (): string => " The merge broke `verify`; the Factory fixed it on this branch:",
    "pt-BR": () => " O merge quebrou o `verify`; a Factory o corrigiu neste branch:",
  }),
  updateVerified: text({ en: (): string => " `verify` passed.", "pt-BR": () => " O `verify` passou." }),

  // The Triage comment: the frame around the verdict. The tag and the door kind stay as the verdict has them.
  triageDisclaimer: text({ en: (): string => "> *This was generated by AI during triage.*", "pt-BR": () => "> *Isto foi gerado por IA durante a Triage.*" }),
  triageHeading: text({ en: (tag: string) => `## Triage: ${tag}`, "pt-BR": (tag) => `## Triage: ${tag}` }),
  triageFallback: text({
    en: (reason: string) => `**${reason}** (no valid verdict; fallback to a human)`,
    "pt-BR": (reason) => `**${reason}** (sem veredito válido; fica com uma pessoa)`,
  }),
  triageDuplicate: text({ en: (issue: number) => `Duplicate of #${issue}. Close one of them.`, "pt-BR": (issue) => `Duplicata de #${issue}. Feche uma delas.` }),
  triageDifficulty: text({ en: (difficulty: string) => `**Difficulty:** ${difficulty}`, "pt-BR": (difficulty) => `**Dificuldade:** ${difficulty}` }),
  triageFiles: text({ en: (): string => "**Files**", "pt-BR": () => "**Arquivos**" }),
  triageClaims: text({ en: (): string => "**Claims checked**", "pt-BR": () => "**Afirmações verificadas**" }),
  triageQuestions: text({ en: (): string => "**Open questions**", "pt-BR": () => "**Perguntas em aberto**" }),
  triageApproach: text({ en: (): string => "**Approach**", "pt-BR": () => "**Abordagem**" }),
  triageReference: text({ en: (symbol: string, foundAt: string) => `\`${symbol}\` at \`${foundAt}\``, "pt-BR": (symbol, foundAt) => `\`${symbol}\` em \`${foundAt}\`` }),
  triageChecked: text({ en: (): string => "**References checked**", "pt-BR": () => "**Referências verificadas**" }),
  triageUnchecked: text({ en: (): string => "**Not found in the code (unchecked)**", "pt-BR": () => "**Não encontradas no código (não verificadas)**" }),
  triageDoor: text({
    en: (kind: string, blastRadius: string) => `**Door:** ${kind}. Blast radius: ${blastRadius}`,
    "pt-BR": (kind, blastRadius) => `**Porta:** ${kind}. Raio de impacto: ${blastRadius}`,
  }),
  triageSeams: text({ en: (): string => "**Seams under test**", "pt-BR": () => "**Seams em teste**" }),
  triageSeam: text({
    en: (seam: string, catches: string, misses: string) => `- ${seam}. Catches: ${catches || "n/a"}. Lets through: ${misses || "n/a"}`,
    "pt-BR": (seam, catches, misses) => `- ${seam}. Detecta: ${catches || "n/d"}. Deixa passar: ${misses || "n/d"}`,
  }),
  // The fallback verdict, written by `triage` into `triage.json`.
  triageTimedOut: text({ en: (): string => "The Triage session timed out.", "pt-BR": () => "A sessão da Triage estourou o tempo." }),
  triageInvalid: text({
    en: (resumes: number) => `The Triage produced no valid verdict after ${resumes} resumes.`,
    "pt-BR": (resumes) => `A Triage não produziu um veredito válido após ${resumes} retomadas.`,
  }),
  triageDecide: text({
    en: (reason: string, ready: string, explore: string) => `${reason} Decide by hand: add the seams and \`${ready}\`, or ask for another \`${explore}\`.`,
    "pt-BR": (reason, ready, explore) => `${reason} Decida à mão: adicione os seams e \`${ready}\`, ou peça outro \`${explore}\`.`,
  }),
  triageLastWords: text({
    en: (tail: string) => `The session's last words (untrusted, not checked):\n\n${tail}`,
    "pt-BR": (tail) => `As últimas palavras da sessão (não confiáveis, não verificadas):\n\n${tail}`,
  }),
  triageNoText: text({ en: (): string => "The session left no usable text.", "pt-BR": () => "A sessão não deixou texto aproveitável." }),
  triageUnassessed: text({ en: (): string => "unknown: nobody has assessed this issue", "pt-BR": () => "desconhecido: ninguém avaliou esta issue" }),

  // The Merge Gate notice of `notify`. `mention` is `@login ` or empty, so each sentence starts in lower case.
  notifyReady: text({
    en: (mention: string, url: string | null) => `${mention}the Factory opened a pull request for this issue and it is ready for review${url ? `: ${url}` : "."}`,
    "pt-BR": (mention, url) => `${mention}a Factory abriu um pull request para esta issue e ele está pronto para revisão${url ? `: ${url}` : "."}`,
  }),
  notifyUpdated: text({
    en: (mention: string, url: string | null) => `${mention}the Factory pushed the answers to your comments to the pull request${url ? `: ${url}` : "."}`,
    "pt-BR": (mention, url) => `${mention}a Factory enviou ao pull request as respostas aos seus comentários${url ? `: ${url}` : "."}`,
  }),
  notifyEscalated: text({
    en: (mention: string, url: string | null) =>
      `${mention}the Factory could not finish this issue and left what it has${url ? ` in a draft pull request: ${url}` : " (see the Escalation comment)."}`,
    "pt-BR": (mention, url) =>
      `${mention}a Factory não conseguiu concluir esta issue e deixou o que tem${url ? ` em um pull request rascunho: ${url}` : " (veja o comentário da Escalation)."}`,
  }),

  // The automatic Retro: its issue and the comment when it found nothing. The marker stays as `retroMarker` writes it.
  retroTitle: text({ en: (issue: number, title: string) => `Retro: #${issue} ${title}`, "pt-BR": (issue, title) => `Retro de #${issue}: ${title}` }),
  retroDisclaimer: text({
    en: (): string => "> *This was generated by the automatic Retro. It only proposes: pick what becomes work, and discard any candidate you cannot trace to the run.*",
    "pt-BR": () => "> *Isto foi gerado pela Retro automática. Ela só propõe: escolha o que vira trabalho e descarte qualquer candidato que você não consiga ligar à execução.*",
  }),
  retroOrigin: text({
    en: (origin: string, runUrl: string | null) => `**Origin:** ${origin}${runUrl ? `. **Retro run:** ${runUrl}` : ""}`,
    "pt-BR": (origin, runUrl) => `**Origem:** ${origin}${runUrl ? `. **Execução da Retro:** ${runUrl}` : ""}`,
  }),
  retroWhatWentWrong: text({ en: (): string => "## What went wrong", "pt-BR": () => "## O que deu errado" }),
  retroCandidates: text({ en: (): string => "## Candidates", "pt-BR": () => "## Candidatos" }),
  retroCategory: text({
    en: (category: RetroCandidate["category"]): string =>
      ({
        navigation: "Navigation",
        "automated-check": "Automated check",
        "coding-standard": "Coding standard",
        "agents-md": "AGENTS.md",
        "tool-economy": "Tool economy",
        "no-op": "No-op",
        "information-access": "Information access",
      })[category],
    "pt-BR": (category) =>
      ({
        navigation: "Navegação",
        "automated-check": "Verificação automática",
        "coding-standard": "Padrão de código",
        "agents-md": "AGENTS.md",
        "tool-economy": "Economia de ferramentas",
        "no-op": "Sem efeito",
        "information-access": "Acesso à informação",
      })[category],
  }),
  retroSeverity: text({
    en: (category: string, severity: string) => `**${category}**, severity ${severity}.`,
    "pt-BR": (category, severity) => `**${category}**, severidade ${severity}.`,
  }),
  retroEvidence: text({ en: (): string => "**Evidence**", "pt-BR": () => "**Evidências**" }),
  retroNoCandidates: text({
    en: (runUrl: string | null) => `The automatic Retro found no candidate it could trace to this run's record, so it opened no issue.${runUrl ? ` Run: ${runUrl}` : ""}`,
    "pt-BR": (runUrl) =>
      `A Retro automática não encontrou nenhum candidato que pudesse ligar ao registro desta execução, então não abriu issue.${runUrl ? ` Execução: ${runUrl}` : ""}`,
  }),

  // The one previews comment of a pull request (`src/ci/previews.ts`).
  previewUntrusted: text({
    en: (label: string) => `Preview not deployed: the author has no write access: someone with write access must add the \`${label}\` label.`,
    "pt-BR": (label) => `Preview não publicado: quem abriu o PR não tem acesso de escrita; alguém com acesso de escrita precisa adicionar o label \`${label}\`.`,
  }),
  previewMissing: text({
    en: (): string => "preview not deployed (the build or the deploy did not finish; see the run)",
    "pt-BR": () => "preview não publicado (o build ou o deploy não terminou; veja a execução)",
  }),
  previewLimitReached: text({ en: (): string => "preview skipped: limit reached", "pt-BR": () => "preview pulado: limite atingido" }),
  previewBindingsChanged: text({
    en: (): string => "preview skipped: the Worker bindings changed (a preview runs with the bindings of the default branch; merge that change first)",
    "pt-BR": () => "preview pulado: os bindings do Worker mudaram (um preview roda com os bindings do branch padrão; faça o merge dessa mudança antes)",
  }),
  previewFailed: text({ en: (): string => "preview failed (see the run)", "pt-BR": () => "o preview falhou (veja a execução)" }),
  previewBadUrl: text({
    en: (): string => "preview deployed, but its URL is not a workers.dev address",
    "pt-BR": () => "preview publicado, mas a URL dele não é um endereço workers.dev",
  }),
  previewReady: text({
    en: (url: string, smoke: "passed" | "failed" | undefined) => `${url} (smoke ${smoke ?? "not run"})`,
    "pt-BR": (url, smoke) => `${url} (smoke ${smoke === "passed" ? "passou" : smoke === "failed" ? "falhou" : "não rodou"})`,
  }),
  previewFooter: text({
    en: (sha: string) => `Commit ${sha}. The preview and its database are deleted when the PR closes.`,
    "pt-BR": (sha) => `Commit ${sha}. O preview e o banco de dados dele são apagados quando o PR fecha.`,
  }),

  // The example issue of `pnpm bootstrap factory` (`src/bootstrap/example.ts`): a parent spec and its child.
  exampleParentTitle: text({
    en: (title: string) => `Example: change the ${title} sign-in title`,
    "pt-BR": (title) => `Exemplo: mudar o título de login de ${title}`,
  }),
  exampleChildTitle: text({
    en: (title: string) => `Example: welcome text on the ${title} sign-in screen`,
    "pt-BR": (title) => `Exemplo: texto de boas-vindas na tela de login de ${title}`,
  }),
  exampleParentBody: text({
    en: (id: string, title: string) =>
      [
        `A throwaway example created by \`pnpm bootstrap factory\` to watch the Factory work on the Product \`${id}\`. It is deleted at the end of the run.`,
        "",
        "## Goal",
        "",
        `Show the Factory turning a small, harmless change to ${title} into a pull request with evidence.`,
        "",
        "## Testing Decisions",
        "",
        `- Seam: the Product's own Playwright E2E spec under \`apps/${id}/e2e/\`, with an \`@evidence\` screenshot of the changed screen.`,
        "- Every text goes through the Product's i18n messages (`en` and `pt-BR`), never as a literal in a component.",
        "- Never change `packages/skeleton`: the Product extends it by configuration only.",
      ].join("\n"),
    "pt-BR": (id, title) =>
      [
        `Um exemplo descartável criado por \`pnpm bootstrap factory\` para ver a Factory trabalhar no Product \`${id}\`. Ele é apagado no fim da execução.`,
        "",
        "## Objetivo",
        "",
        `Mostrar a Factory transformando uma mudança pequena e inofensiva em ${title} num pull request com evidência.`,
        "",
        "## Testing Decisions",
        "",
        `- Seam: o spec Playwright E2E do próprio Product em \`apps/${id}/e2e/\`, com um screenshot \`@evidence\` da tela alterada.`,
        "- Todo texto passa pelas mensagens de i18n do Product (`en` e `pt-BR`), nunca como literal num componente.",
        "- Nunca altere `packages/skeleton`: o Product só o estende por configuração.",
      ].join("\n"),
  }),
  exampleChildBody: text({
    en: (id: string, title: string, parent: number) =>
      [
        `Part of #${parent}. A throwaway example; it is deleted at the end.`,
        "",
        "## What to build",
        "",
        `Override the sign-in screen title in \`apps/${id}/product.config.ts\`, in \`messages\` for both locales: \`auth.signIn.title\` becomes "Welcome to ${title}" in \`en\` and "Bem-vindo ao ${title}" in \`pt-BR\`. The Skeleton already renders this text, so no change outside \`apps/${id}/\` is needed.`,
        "",
        "## Acceptance criteria",
        "",
        `- [ ] \`apps/${id}/product.config.ts\` overrides \`auth.signIn.title\` in \`en\` and \`pt-BR\` with the texts above.`,
        `- [ ] The Product's own E2E spec under \`apps/${id}/e2e/\` checks that the sign-in screen shows the new title and prints an \`@evidence\` screenshot.`,
        "- [ ] Nothing under `packages/skeleton/` changes.",
      ].join("\n"),
    "pt-BR": (id, title, parent) =>
      [
        `Parte de #${parent}. Um exemplo descartável; ele é apagado no fim.`,
        "",
        "## O que construir",
        "",
        `Sobrescrever o título da tela de login em \`apps/${id}/product.config.ts\`, em \`messages\` nos dois idiomas: \`auth.signIn.title\` passa a ser "Welcome to ${title}" em \`en\` e "Bem-vindo ao ${title}" em \`pt-BR\`. O Skeleton já mostra esse texto, então nenhuma mudança fora de \`apps/${id}/\` é necessária.`,
        "",
        "## Acceptance criteria",
        "",
        `- [ ] \`apps/${id}/product.config.ts\` sobrescreve \`auth.signIn.title\` em \`en\` e \`pt-BR\` com os textos acima.`,
        `- [ ] O spec E2E do próprio Product em \`apps/${id}/e2e/\` confere que a tela de login mostra o novo título e gera um screenshot \`@evidence\`.`,
        "- [ ] Nada em `packages/skeleton/` muda.",
      ].join("\n"),
  }),
};

export type Messages = { [K in keyof typeof catalog]: (typeof catalog)[K]["en"] };

/** The fixed texts in `language`. */
export function messages(language: Language): Messages {
  return Object.fromEntries(
    Object.entries(catalog).map(([key, entry]) => [key, (entry as Partial<Record<Language, Text>>)[language] ?? entry.en]),
  ) as Messages;
}
