export interface SetupAccount {
  id: string;
  name: string;
  account_status?: number;
}

interface AccountsResponse {
  data?: SetupAccount[];
  available?: SetupAccount[];
}

// /api/meta only accepts known `kind` queries; the setup wizard lists every account
// the token can reach (`available`), not the saved selection (`data`).
export const setupAccountsPath = 'meta?kind=accounts';

export function setupAccountsFromResponse(response: AccountsResponse) {
  const accounts = response.available ?? response.data ?? [];
  const active = accounts.filter((account) => account.account_status === 1).map((account) => account.id);
  return { accounts, selected: active.length > 0 ? active : accounts.map((account) => account.id) };
}
