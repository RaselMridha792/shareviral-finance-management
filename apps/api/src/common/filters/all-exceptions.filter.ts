import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { getRequestContext } from "../context/request-context";

type ErrorBody = {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
  requestId?: string;
  path: string;
};

/**
 * One response shape for every failure, so the web client has a single thing to
 * parse. Internal errors are logged with the request id and reported to the
 * caller as a generic message — a finance API must not leak stack traces or
 * driver text (which can contain column values) to the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exception");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = getRequestContext()?.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = "Internal server error";
    let errors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === "string") {
        message = payload;
      } else if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;
        message =
          typeof record.message === "string"
            ? record.message
            : Array.isArray(record.message)
              ? record.message.join(", ")
              : exception.message;
        if (record.errors && typeof record.errors === "object") {
          errors = record.errors as Record<string, string[]>;
        }
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.originalUrl} [${requestId ?? "-"}]`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = {
      statusCode: status,
      message,
      path: request.originalUrl ?? request.url,
    };
    if (errors) body.errors = errors;
    if (requestId) body.requestId = requestId;

    response.status(status).json(body);
  }
}
