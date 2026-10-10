const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function dbFor(env) {
  if (!env.DB) throw new ApiError('Salas indisponíveis neste momento. Tente novamente.', 503);
  return env.DB;
}

export { ApiError, dbFor, json };
