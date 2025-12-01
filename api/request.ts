/**
 * Base URL for backend API requests, taken from environment variables.
 * Falls back to an empty string if not defined.
 * @type {string}
 */
const baseUrl = process.env.BACKEND_URL ?? "";

/**
 * Allowed HTTP methods for the request helper.
 * @typedef {"GET" | "POST" | "PUT" | "DELETE"} Method
 */
type Method = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Configuration object for the request function.
 *
 * @typedef {Object} RequestOptions
 * @property {Method} method - HTTP method to use.
 * @property {string} endpoint - API endpoint relative to the backend base URL.
 * @property {unknown} [data] - Optional body payload for POST or PUT requests.
 * @property {Record<string, string>} [params] - Optional query string parameters.
 * @property {Record<string, string>} [headers] - Optional request headers.
 */
type RequestOptions = {
  method: Method;
  endpoint: string;
  data?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  token?: string;
};

/**
 * Performs an HTTP request to the backend API.
 *
 * @template T
 * @param {RequestOptions} options - Configuration for the request.
 * @returns {Promise<T>} Resolves with the parsed JSON response cast to type T.
 *
 * @example
 * ```ts
 * const user = await request<User>({
 *   method: "GET",
 *   endpoint: "/api/users/123",
 * });
 * ```
 */
export async function request<T>(options: RequestOptions): Promise<T> {
  const url = new URL(`${baseUrl}${options.endpoint}`);

  // Append URL search parameters if provided
  if (options.params) {
    for (const key in options.params) {
      url.searchParams.append(key, String(options.params[key]));
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method,
    headers: options.headers,
    body:
      options.method === "GET" || options.method === "DELETE"
        ? undefined
        : JSON.stringify(options.data),
  });

  const json = await response.json();
  return json as T;
}
