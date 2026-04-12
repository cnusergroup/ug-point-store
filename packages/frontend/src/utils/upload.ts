/**
 * 上传重试工具函数
 * 统一处理上传请求的重试逻辑和错误分类
 */

/** 上传错误类型 */
export type UploadErrorType = 'TOKEN_EXPIRED' | 'NETWORK_ERROR' | 'SERVER_ERROR';

/** 上传错误类 */
export class UploadError extends Error {
  constructor(
    public type: UploadErrorType,
    message: string,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * 带重试机制的上传请求
 *
 * 错误处理策略：
 * - HTTP 403：不重试，抛出 TOKEN_EXPIRED
 * - HTTP 500：不重试，抛出 SERVER_ERROR
 * - 网络错误（fetch 抛出异常）：重试，全部失败后抛出 NETWORK_ERROR
 * - 其他 HTTP 错误：重试，全部失败后抛出对应错误
 *
 * @param url 上传目标 URL
 * @param options fetch 请求配置
 * @param maxRetries 最大重试次数，默认 2
 * @param retryDelay 重试间隔（毫秒），默认 2000
 * @returns 成功的 Response（2xx 状态码）
 */
export async function uploadWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 2,
  retryDelay: number = 2000,
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);

      // 成功响应
      if (response.ok) {
        return response;
      }

      // HTTP 403：令牌过期，不重试
      if (response.status === 403) {
        throw new UploadError('TOKEN_EXPIRED', '上传授权已过期，请重新获取上传链接');
      }

      // HTTP 500：服务器错误，不重试
      if (response.status === 500) {
        throw new UploadError('SERVER_ERROR', '服务器错误，请稍后重试');
      }

      // 其他 HTTP 错误：记录后重试
      lastError = new Error(`Upload failed with status ${response.status}`);
    } catch (err) {
      // UploadError 不重试，直接抛出
      if (err instanceof UploadError) {
        throw err;
      }

      // 网络错误（fetch 本身抛出的异常）：记录后重试
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    // 还有重试机会则等待后继续
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  // 所有重试均失败，抛出网络错误
  throw new UploadError('NETWORK_ERROR', '网络不稳定，请稍后重试');
}
