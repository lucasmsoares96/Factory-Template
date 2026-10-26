/**
 * Where the test composition's features record each `companyDeleting`, with the
 * Members the Company still had then: a table of the test database only. The
 * tests create it too, to read it before any deletion ran.
 */
export const createDeletingCompanies =
  "CREATE TABLE IF NOT EXISTS public.deleting_companies (seq serial PRIMARY KEY, company_id text, feature text, members int)";
