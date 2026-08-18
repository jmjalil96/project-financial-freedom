export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export function getPublicErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DomainError) {
    return error.message;
  }

  console.error(error);
  return fallback;
}
