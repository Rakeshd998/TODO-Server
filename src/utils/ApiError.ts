class ApiError extends Error {
  public statusCode: number;
  public errors: string[];
  public success: boolean;

  constructor(statusCode: number, message: string, errors: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.success = false;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export default ApiError;
