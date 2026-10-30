import { expect, test } from "vitest";
import { priceChangeEmail } from "../src/emails/price-change.tsx";
import { messagesFor } from "../src/i18n/index.ts";

const values = { to: "owner@example.com", name: "Ana", planName: "Pro", oldPrice: "R$ 19,00", newPrice: "R$ 29,00", startsOn: "15 de janeiro de 2031", url: "https://app.test/account/plan" };

test("the price-change email is written in the app's language, with the old price, the new price and the date", async () => {
  const pt = await priceChangeEmail({ t: messagesFor("pt-BR"), ...values });
  expect(pt.subject).toBe("O preço do Pro muda em 15 de janeiro de 2031");
  expect(pt.text).toContain("R$ 19,00");
  expect(pt.text).toContain("R$ 29,00");
  expect(pt.text).toContain("próxima renovação");

  const en = await priceChangeEmail({ t: messagesFor("en"), ...values });
  expect(en.subject).toBe("The price of Pro is changing on 15 de janeiro de 2031");
  expect(en.text).toContain("next renewal");
});
