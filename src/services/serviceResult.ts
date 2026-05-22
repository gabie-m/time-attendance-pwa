export type ServiceResult<T> =
  | {
      success: true;
      data: T;
      error: null;
    }
  | {
      success: false;
      data: null;
      error: string;
    };

export function success<T>(data: T): ServiceResult<T> {
  return {
    success: true,
    data,
    error: null
  };
}

export function failure<T>(error: string): ServiceResult<T> {
  return {
    success: false,
    data: null,
    error
  };
}
