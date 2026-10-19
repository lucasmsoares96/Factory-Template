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
  auth: {
    signUp: {
      title: "Crie a sua conta",
      description: "Cadastre-se com o seu email e uma senha.",
      name: "Nome",
      email: "Email",
      password: "Senha",
      passwordHint: "Pelo menos 8 caracteres.",
      submit: "Criar conta",
      submitting: "Criando a sua conta…",
    },
    checkEmail: {
      title: "Confira o seu email",
      description: "Enviamos um link de verificação para {email}. Abra o link para começar a usar o {appName}.",
      resend: "Enviar o link de novo",
      resending: "Enviando…",
      resent: "Enviamos um link novo. Ele pode levar um minuto para chegar.",
    },
    emailVerified: {
      title: "Email verificado",
      description: "O seu email está verificado. Agora você já pode entrar.",
      failedTitle: "Não conseguimos verificar o seu email",
    },
  },
  emails: {
    verifyEmail: {
      subject: "Confirme o seu email",
      preview: "Confirme o seu email para começar a usar o {appName}.",
      heading: "Confirme o seu email",
      greeting: "Olá, {name},",
      body: "Confirme que {email} é o seu endereço de email para começar a usar o {appName}.",
      button: "Confirmar email",
      fallback: "Se o botão não funcionar, abra este link:",
      ignore: "Se você não criou uma conta, pode ignorar este email.",
    },
  },
  errors: {
    NOT_FOUND: "Não encontramos o que você pediu.",
    VALIDATION_FAILED: "Alguma informação não é válida.",
    INTERNAL_ERROR: "Algo deu errado do nosso lado. Tente de novo.",
    DATABASE_UNAVAILABLE: "O serviço está indisponível no momento. Tente de novo em breve.",
    INVALID_EMAIL: "Informe um endereço de email válido.",
    PASSWORD_TOO_SHORT: "A senha é curta demais.",
    PASSWORD_TOO_LONG: "A senha é longa demais.",
    USER_ALREADY_EXISTS: "Já existe uma conta com este email.",
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com este email. Use outro email.",
    EMAIL_NOT_VERIFIED: "Confirme o seu email antes de continuar.",
    INVALID_TOKEN: "Este link não é válido. Peça um novo.",
    TOKEN_EXPIRED: "Este link expirou. Peça um novo.",
    USER_NOT_FOUND: "Não encontramos esta conta.",
    unexpected: "Algo deu errado. Confira a sua conexão e tente de novo.",
  },
};
