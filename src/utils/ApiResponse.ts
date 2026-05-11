class ApiResponse<T> {
  public success: boolean;
  public statusCode: number;
  public message: string;
  public data: T | null;

  constructor(statusCode: number, message: string, data: T | null = null) {
    this.statusCode = statusCode;
    this.success = statusCode < 400;
    this.message = message;
    this.data = data;
  }
}

export default ApiResponse;
