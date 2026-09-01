/** Typed, generated-contract fetch client. Do not add endpoint types here. */

import createClient from 'openapi-fetch';

import type { paths } from './schema';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const typedApiClient = createClient<paths>({
  baseUrl: BASE_URL,
  credentials: 'include',
});
