import type { Messages } from "./en.ts";

export const ptBR: Messages = {
  app: {
    title: "Skeleton",
  },
  home: {
    title: "Boas-vindas",
    apiStatusLabel: "Status da API",
    checking: "Verificando…",
    apiStatus: { ok: "Funcionando" },
  },
  errors: {
    NOT_FOUND: "Não encontramos o que você pediu.",
    VALIDATION_FAILED: "Alguma informação não é válida.",
    INTERNAL_ERROR: "Algo deu errado do nosso lado. Tente de novo.",
    DATABASE_UNAVAILABLE: "O serviço está indisponível no momento. Tente de novo em breve.",
    unexpected: "Algo deu errado. Confira a sua conexão e tente de novo.",
  },
};
