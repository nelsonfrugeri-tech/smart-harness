import { STATUS_CODES } from "node:http";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

// Error responses follow RFC 9457 (application/problem+json). `type` stays "about:blank",
// so `title` is the HTTP status text; `code` is the stable value clients branch on.

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export interface FieldError {
  path: string;
  message: string;
}

export interface Problem {
  type: "about:blank";
  title: string;
  status: number;
  code: string;
  detail?: string;
  correlation_id: string;
  errors?: FieldError[];
}

// Thrown by handlers for expected failures; the error handler turns it into a problem.
export class HttpProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly headers: Record<string, string>;

  constructor(
    status: number,
    code: string,
    detail?: string,
    headers: Record<string, string> = {},
  ) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.headers = headers;
  }
}

export function notFound(detail = "resource not found"): HttpProblem {
  return new HttpProblem(404, "not_found", detail);
}

export function unauthorized(code: string, detail: string): HttpProblem {
  // RFC 6750: tell the client which scheme the API expects.
  return new HttpProblem(401, code, detail, { "www-authenticate": 'Bearer realm="smart-harness"' });
}

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  detail?: string,
  errors?: FieldError[],
): FastifyReply {
  const problem: Problem = {
    type: "about:blank",
    title: STATUS_CODES[status] ?? "Error",
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    correlation_id: request.id,
    ...(errors === undefined ? {} : { errors }),
  };
  return reply.code(status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

// Codes for the 4xx errors Fastify raises itself (bad JSON, wrong content type, body too large).
const CLIENT_ERROR_CODES: Record<number, string> = {
  400: "bad_request",
  404: "not_found",
  413: "payload_too_large",
  415: "unsupported_media_type",
};

export function registerProblemHandlers(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, 404, "not_found", `route ${request.method} ${request.url} not found`),
  );

  app.setErrorHandler((error: FastifyError | HttpProblem, request, reply) => {
    if (error instanceof HttpProblem) {
      reply.headers(error.headers);
      return sendProblem(request, reply, error.status, error.code, error.detail);
    }

    if (error.validation) {
      const errors = error.validation.map((issue) => ({
        path: issue.instancePath === "" ? "/" : issue.instancePath,
        message: issue.message ?? "is invalid",
      }));
      return sendProblem(request, reply, 400, "validation_failed", "request is invalid", errors);
    }

    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return sendProblem(request, reply, status, CLIENT_ERROR_CODES[status] ?? "client_error", error.message);
    }

    // Unexpected failure: log the cause, never send internals to the client.
    request.log.error({ err: error }, "unhandled error");
    return sendProblem(request, reply, 500, "internal_error", "unexpected error; quote the correlation_id");
  });
}
