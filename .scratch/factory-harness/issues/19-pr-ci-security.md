# Segurança do CI do PR com código da Factory

Type: grilling
Status: open

## Question

O workflow de preview por PR (`pull_request`, branch do mesmo repo) executa código escrito pelo agente (`package.json` com `postinstall`, `drizzle.config.ts`, build, testes) num job que tem os tokens do Cloudflare e do Neon. Um `postinstall` malicioso, vindo de injeção de prompt na issue, vazaria esses secrets. Com o [Ambiente de preview por PR](05-pr-preview-environments.md) e a [Anatomia do job da Factory e interface do adaptador de forja](16-factory-job-anatomy.md) já decididos, como separar o CI do PR para que código do branch nunca rode com secrets? Pontos a fechar:
- **Build sem secrets → deploy com código da `main`**: job de build/teste sem secrets que gera artefatos (bundle do Worker, migrations SQL); job de deploy que faz checkout da `main` e só aplica os artefatos (`wrangler preview`, `drizzle-kit migrate` ou SQL puro). As migrations SQL geradas pelo agente são código também: o que pode rodar contra o branch Neon do PR?
- **Escopo dos tokens**: token do Cloudflare restrito a Workers Previews? Token do Neon restrito ao projeto, ou API key só para branches?
- **Smoke pós-deploy**: o Playwright do smoke é código do PR; precisa de algum secret?
- **`workflow_run` × `pull_request_target`** como gatilho do job com secrets, e o que disso porta para o Forgejo (que ignora `permissions:`).
- **Aprovação**: PRs do machine user exigem algo antes do deploy do preview, ou o isolamento basta?
