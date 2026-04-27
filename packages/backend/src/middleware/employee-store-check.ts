/**
 * 判断员工用户是否被拦截使用商城。
 * 仅当 isEmployee=true 且 employeeStoreEnabled=false 时返回 true。
 */
export function isEmployeeStoreBlocked(
  isEmployee: boolean,
  employeeStoreEnabled: boolean,
): boolean {
  return isEmployee && !employeeStoreEnabled;
}
