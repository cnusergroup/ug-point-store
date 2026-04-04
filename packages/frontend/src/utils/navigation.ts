import Taro from '@tarojs/taro';

/**
 * Navigate back with fallback.
 *
 * In Taro H5 mode, refreshing the browser clears the navigation stack.
 * When `Taro.navigateBack()` is called with no previous page in the stack,
 * nothing happens. This helper checks the stack first and falls back to
 * `Taro.redirectTo` with the given URL when the stack is empty.
 */
export function goBack(fallbackUrl: string): void {
  const pages = Taro.getCurrentPages();
  if (pages.length > 1) {
    Taro.navigateBack({ delta: 1 });
  } else {
    Taro.redirectTo({ url: fallbackUrl });
  }
}
